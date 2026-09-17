import { and, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { employees, skillFacts } from "@/lib/db/schema";
import type { CurrentUser } from "@/lib/auth/session";
import { loadSkillReferences, normalize } from "@/lib/import-pipeline/par-scoring";
import { eligibleForPeriod } from "./eligibility";
import {
  joinPeriodOwner,
  managerOfRecord,
  periodOwnerSubquery,
  reportingScopeIds,
  siteOfRecord,
  supervisorOfRecord,
} from "./org-history";
import type { Period } from "./period";

/**
 * The Team Roster page's reads: which team leads a viewer may browse, and
 * one lead's whole team with the hours behind each agent's numbers.
 *
 * The KPI cells themselves come from `getTeamPeriodComparison` — the same
 * figures the dashboard's collapsed table shows, so the two can never
 * disagree about one agent. This module only answers the questions that
 * table does not: who the leads are, who is on a lead's team for the period,
 * and how each agent's productive hours split between phone and non-phone
 * work.
 */

export const UNASSIGNED = "Unassigned";

export interface TeamMember {
  employeeId: string;
  eid: string;
  name: string;
}

export interface TeamLead {
  name: string;
  site: string | null;
  manager: string | null;
  /** Everyone the period says reported to them — the roster, not only those with results. */
  members: TeamMember[];
}

/**
 * Every team lead the viewer may browse for this period, alphabetically.
 *
 * Scoped by `reportingScopeIds`, which is the period's org rather than
 * today's: an admin gets everyone, a manager gets their own span, and both
 * get whoever actually held these people for most of the period. A viewer
 * whose account is not linked to the imported data resolves to nobody, the
 * same way every other read here fails closed.
 *
 * Separated and not-yet-hired people are dropped (`eligibleForPeriod`) — a
 * roster should not list someone who was not there — but nobody is dropped
 * for lacking results. That is the whole point of this page against the
 * dashboard's preview: an agent with no data is a row of dashes you can see,
 * not a row that silently disappears.
 */
export async function listTeamLeads(user: CurrentUser, period: Period): Promise<TeamLead[]> {
  const scoped = await reportingScopeIds(user, period);
  if (scoped.length === 0) return [];

  const owner = periodOwnerSubquery(period);
  const rows = await db
    .select({
      employeeId: employees.id,
      eid: employees.eid,
      name: employees.name,
      supervisor: supervisorOfRecord(owner),
      manager: managerOfRecord(owner),
      site: siteOfRecord(owner),
    })
    .from(employees)
    .leftJoin(owner, joinPeriodOwner(owner))
    .where(inArray(employees.id, scoped));

  const eligible = new Set(await eligibleForPeriod(rows.map((r) => r.employeeId), period));
  return groupIntoLeads(rows.filter((r) => eligible.has(r.employeeId)));
}

/**
 * Roster rows folded into one entry per lead.
 *
 * A lead with people at two sites or under two managers keeps one row — they
 * are one team — and the site and manager shown are whichever the majority of
 * their people carry, so a single mis-keyed masterlist row cannot relabel a
 * whole team. Ties go to the alphabetically first, for a stable answer.
 *
 * Pure, so the majority rule can be pinned down in a test without a database.
 */
export function groupIntoLeads(
  rows: Array<
    TeamMember & { supervisor: string | null; manager: string | null; site: string | null }
  >,
): TeamLead[] {
  const teams = new Map<string, { members: TeamMember[]; sites: string[]; managers: string[] }>();
  for (const row of rows) {
    const name = row.supervisor || UNASSIGNED;
    const team = teams.get(name) ?? { members: [], sites: [], managers: [] };
    team.members.push({ employeeId: row.employeeId, eid: row.eid, name: row.name });
    if (row.site) team.sites.push(row.site);
    if (row.manager) team.managers.push(row.manager);
    teams.set(name, team);
  }

  return [...teams.entries()]
    .map(([name, team]) => ({
      name,
      site: majority(team.sites),
      manager: majority(team.managers),
      members: team.members.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A team lead's first name, for the page to title itself "Team Brandon".
 *
 * The roster carries two name formats side by side, because the source
 * workbooks do: "Sacurom, Lovely Mae Enot" and "Victor Fuentenegra" are both
 * real rows, and the comma is sometimes written without a space after it
 * ("Ladera,Cyril Pongasi"). So the comma decides — everything after it is
 * the given names, and the first of those is the one wanted. With no comma
 * the row is already given-names-first and the leading word is the answer.
 *
 * Returns null rather than a guess for anything that yields no word, the
 * "Unassigned" bucket included: a heading reading "Team Unassigned" would
 * name a team lead who does not exist.
 */
export function leadFirstName(fullName: string): string | null {
  if (fullName === UNASSIGNED) return null;
  const comma = fullName.indexOf(",");
  const givenNames = comma >= 0 ? fullName.slice(comma + 1) : fullName;
  return givenNames.trim().split(/\s+/)[0] || null;
}

/** The most common value, ties resolved alphabetically; null for nothing at all. */
function majority(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return (
    [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null
  );
}

export interface AgentHours {
  /** Productive hours on skills scored by handle time — the phone queues. */
  phone: number;
  /** Productive hours on every other skill: fax, OCN and the case-rate work. */
  nonPhone: number;
  /** Which skills landed in which bucket, so the split can be checked rather than trusted. */
  breakdown: Array<{ skill: string; hours: number; phone: boolean }>;
}

/**
 * Each agent's productive hours for the period, split phone / non-phone.
 *
 * **Where the split comes from.** Nothing in the data marks a skill as a
 * phone skill, so this reads the skill reference's scoring metric: a skill
 * scored by average handle time is a phone skill, because handle time is a
 * measure of a call. Everything else — the cases-per-hour and case-rate
 * skills, which is the fax and back-office work — is non-phone. Confirmed
 * as the business's own rule by the owner on 17 Sep; it is an inference off
 * the scoring metric rather than a stored flag, so if a future skill is
 * scored by handle time without being a phone queue, this is the line that
 * has to change. The per-skill breakdown travels with the figures so a
 * leader can see exactly what was counted as which, instead of taking the
 * label on faith.
 *
 * Hours are `skill_facts.hours`, the productive hours the workbook reports
 * per skill per day — the same quantity every rate on this page divides by.
 * Case-rate skills do carry hours (their prod weight is cases² / hours in
 * this data), so non-phone hours are a real figure rather than a zero.
 *
 * A skill the reference table does not know is left out rather than guessed
 * into a bucket; it would also be missing from the ratings, and inventing a
 * side for it here would make the two disagree.
 */
export async function getAgentHours(
  employeeIds: string[],
  period: Period,
): Promise<Map<string, AgentHours>> {
  const out = new Map<string, AgentHours>();
  if (employeeIds.length === 0) return out;

  const [facts, references] = await Promise.all([
    db
      .select({
        employeeId: skillFacts.employeeId,
        skillLabel: skillFacts.skillLabel,
        hours: sql<number>`sum(${skillFacts.hours})::double precision`,
      })
      .from(skillFacts)
      .where(
        and(
          inArray(skillFacts.employeeId, employeeIds),
          gte(skillFacts.factDate, period.start),
          lte(skillFacts.factDate, period.end),
        ),
      )
      .groupBy(skillFacts.employeeId, skillFacts.skillLabel),
    loadSkillReferences(),
  ]);

  for (const row of facts) {
    const reference = references.get(normalize(row.skillLabel));
    if (!reference) continue;
    const phone = reference.metric === "aht";
    const entry = out.get(row.employeeId) ?? { phone: 0, nonPhone: 0, breakdown: [] };
    if (phone) entry.phone += row.hours;
    else entry.nonPhone += row.hours;
    entry.breakdown.push({ skill: reference.name, hours: row.hours, phone });
    out.set(row.employeeId, entry);
  }

  for (const entry of out.values()) {
    entry.breakdown.sort((a, b) => b.hours - a.hours || a.skill.localeCompare(b.skill));
  }
  return out;
}
