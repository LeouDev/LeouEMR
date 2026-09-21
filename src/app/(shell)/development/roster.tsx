"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { StatusBadge } from "@/components/ui";
import { actionItemLinks } from "@/lib/development/item-links";
import { SUSTAINED_WEEKS } from "@/lib/development/sustained";
import { rosterViewStore, toggled } from "@/lib/development/roster-view";
import { FROM_DEVELOPMENT, withReturn } from "@/lib/development/return-to";
// Types only: importing a VALUE from the query module would pull the
// database into this client bundle (see sustained.ts).
import type { DevelopmentRow, RosterManager, RosterTeamLead } from "@/lib/queries/development";
import { ProgressMatrix } from "../employees/[employeeId]/progress-matrix";
import { SkillBreakdownTable } from "../employees/[employeeId]/skill-breakdown-table";
import { loadAgentDetail, type AgentDetail } from "./actions";

/**
 * The Development Hub as a roster: manager, then team leader, then agent,
 * each level its own expander.
 *
 * A span of a hundred and forty people in development cannot be read as one
 * list of names. The flat table this replaces is the right shape for a
 * supervisor with eight and the wrong one for a manager or an admin, who
 * are asking "which of my team leaders is behind" before they ask about any
 * one agent. Every level is collapsed to begin with, so the page opens on
 * that question rather than on its answer.
 *
 * An agent's own detail — the KPI grid, the skill breakdown — is fetched
 * when their row is opened and never before (see ./actions.ts). "Expand
 * all" deliberately stops at the team-leader level for the same reason:
 * opening every agent at once would ask the server for a hundred and forty
 * KPI grids nobody has looked at.
 */

const CHIP = "px-2 py-[3px] text-[11px] font-bold";
const SECTION = "text-[11px] font-bold tracking-[0.1em] text-orange-brand uppercase";

function Chevron({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block w-[9px] text-xs text-muted transition-transform duration-[120ms] ${open ? "rotate-90" : ""}`}
    >
      ▸
    </span>
  );
}

export function DevelopmentRoster({
  managers,
  groupByManager,
}: {
  managers: RosterManager[];
  /** Admins read the managers; a manager is already inside one, so theirs opens at their team leaders. */
  groupByManager: boolean;
}) {
  // Where this reader was, kept in the tab rather than in state: following
  // an item's link and coming back would otherwise land them on a collapsed
  // roster with their place lost (see lib/development/roster-view.ts).
  const view = useSyncExternalStore(
    rosterViewStore.subscribe,
    rosterViewStore.read,
    rosterViewStore.serverRead,
  );

  const leads = managers.flatMap((m) => m.teamLeads);
  // Derived rather than stored: "expand all" is a statement about the rows
  // on screen, and a stored flag would disagree with them the moment one
  // was closed by hand.
  const allOpen =
    leads.length > 0 && leads.every((l) => view.leads.includes(l.name)) &&
    managers.every((m) => view.managers.includes(m.name));

  function toggleAll() {
    const next = !allOpen;
    rosterViewStore.save({
      ...view,
      managers: next ? managers.map((m) => m.name) : [],
      leads: next ? leads.map((l) => l.name) : [],
    });
  }

  return (
    <>
      <div className="flex justify-end border-b-2 border-ink px-5 py-3">
        <button
          type="button"
          onClick={toggleAll}
          className="border-2 border-ink bg-surface px-3.5 py-1.5 text-sm font-semibold text-ink transition hover:border-orange-brand hover:text-orange-brand"
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>

      {groupByManager
        ? managers.map((manager) => (
            <div key={manager.name} className="border-b-2 border-ink last:border-b-0">
              <button
                type="button"
                aria-expanded={view.managers.includes(manager.name)}
                onClick={() => rosterViewStore.save({ ...view, managers: toggled(view.managers, manager.name) })}
                // Quieter than an open team leader's row below it, on
                // purpose: with both bands the same accent the tree read
                // flat, and the level you are actually reading is the one
                // that should carry the colour.
                className={`flex w-full items-center gap-3 px-5 py-3.5 text-left transition hover:bg-cream ${
                  view.managers.includes(manager.name) ? "bg-cream" : "bg-surface"
                }`}
              >
                <Chevron open={view.managers.includes(manager.name)} />
                <span className="min-w-0 flex-1">
                  <strong className="text-sm font-bold text-ink">{manager.name}</strong>
                  <span className="ml-2 text-xs text-muted">
                    {manager.teamLeadCount} team lead{manager.teamLeadCount === 1 ? "" : "s"} ·{" "}
                    {manager.headcount} in development
                  </span>
                </span>
              </button>
              {view.managers.includes(manager.name) && (
                <div className="bg-cream/40 pl-5">
                  {manager.teamLeads.map((lead) => (
                    <TeamLeadRow
                      key={lead.name}
                      lead={lead}
                      open={view.leads.includes(lead.name)}
                      onToggle={() => rosterViewStore.save({ ...view, leads: toggled(view.leads, lead.name) })}
                    />
                  ))}
                </div>
              )}
            </div>
          ))
        : leads.map((lead) => (
            <TeamLeadRow
              key={lead.name}
              lead={lead}
              open={view.leads.includes(lead.name)}
              onToggle={() => rosterViewStore.save({ ...view, leads: toggled(view.leads, lead.name) })}
            />
          ))}
    </>
  );
}

function TeamLeadRow({
  lead,
  open,
  onToggle,
}: {
  lead: RosterTeamLead;
  open: boolean;
  onToggle: () => void;
}) {
  const view = useSyncExternalStore(
    rosterViewStore.subscribe,
    rosterViewStore.read,
    rosterViewStore.serverRead,
  );

  return (
    <div className="border-b-2 border-line last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={`flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-left transition hover:bg-cream ${
          open ? "bg-orange-brand-100" : "bg-surface"
        }`}
      >
        <Chevron open={open} />
        <span className="min-w-[200px] flex-1">
          <strong className="text-sm font-bold text-ink">{lead.name}</strong>
          <span className="ml-2 text-xs text-muted">
            {lead.site ?? "No site"} · {lead.headcount} in development
          </span>
        </span>
        {/* Each chip only when it has something to say: a row of zeroes
            reads as noise on a board whose whole job is to show what is
            outstanding. */}
        <span className="flex flex-wrap items-center gap-2">
          {lead.missingRca > 0 && (
            <span className={`${CHIP} bg-fail-bg text-fail`}>{lead.missingRca} need RCA</span>
          )}
          {lead.missingPlan > 0 && (
            <span className={`${CHIP} bg-warn-bg text-warn`}>{lead.missingPlan} need plan</span>
          )}
          {lead.awaitingAcknowledgement > 0 && (
            <span className={`${CHIP} bg-warn-bg text-warn`}>{lead.awaitingAcknowledgement} awaiting ack</span>
          )}
          {lead.needsTraining > 0 && (
            <span className={`${CHIP} bg-orange-brand-100 text-ink`}>{lead.needsTraining} need training</span>
          )}
          {lead.needsCoaching > 0 && (
            <span className={`${CHIP} bg-orange-brand-100 text-ink`}>{lead.needsCoaching} need coaching</span>
          )}
          {lead.nearingClose > 0 && (
            <span className={`${CHIP} bg-pass-bg text-pass`}>{lead.nearingClose} nearing close</span>
          )}
          {lead.topKpi && (
            <span className="text-[11px] text-muted">
              Top KPI: {lead.topKpi.name} ({lead.topKpi.count})
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="bg-surface pl-6">
          {lead.agents.map((agent) => (
            <AgentRow
              key={agent.employeeId}
              agent={agent}
              open={view.agents.includes(agent.employeeId)}
              onToggle={() =>
                rosterViewStore.save({ ...view, agents: toggled(view.agents, agent.employeeId) })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentRow({
  agent,
  open,
  onToggle,
}: {
  agent: DevelopmentRow;
  open: boolean;
  onToggle: () => void;
}) {
  const [detail, setDetail] = useState<AgentDetail>(null);
  const [failed, setFailed] = useState(false);
  const [loading, startLoading] = useTransition();

  // Fetched because the row is open, not because it was clicked. A row can
  // now arrive already open — the reader followed an item's link and came
  // back — and a fetch hung off the click would leave that row showing its
  // plan with no figures above it until it was closed and opened again.
  //
  // Fetched once and kept: re-opening a row already looked at should not ask
  // the server for the same grid, and a failure is not retried on every
  // render either.
  useEffect(() => {
    if (!open || detail || failed || loading) return;
    startLoading(async () => {
      try {
        const next = await loadAgentDetail(agent.employeeId);
        setDetail(next);
        setFailed(next === null);
      } catch {
        setFailed(true);
      }
    });
  }, [open, detail, failed, loading, agent.employeeId]);

  return (
    <div className="border-b border-line last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition hover:bg-cream ${
          open ? "bg-cream" : "bg-surface"
        }`}
      >
        <Chevron open={open} />
        <span className="min-w-[160px] flex-1 text-[13px] font-semibold text-ink">{agent.employeeName}</span>
        <span className="text-xs text-muted">
          {agent.openItems} open item{agent.openItems === 1 ? "" : "s"}
        </span>
        <span className={`text-xs font-bold ${toneOf(agent.urgency)}`}>{agent.nextStep}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-5 border-t border-line bg-surface px-4 py-4 pl-8">
          <div>
            <Link
              href={`/employees/${agent.employeeId}`}
              className="text-xs font-semibold text-muted underline underline-offset-4 transition hover:text-orange-brand"
            >
              Open {agent.employeeName}&rsquo;s full profile
            </Link>
          </div>
          {loading && <p className="text-sm text-muted">Loading {agent.employeeName}&rsquo;s figures…</p>}
          {/* The plan below is already on the page and still current, so a
              failed figures fetch says so rather than emptying the row. */}
          {failed && (
            <p className="text-sm text-fail">
              Could not load the figures for this agent. The development plan below is still current.
            </p>
          )}
          {detail && (
            <>
              <div>
                <h4 className={`${SECTION} mb-2`}>Weekly KPI</h4>
                <div className="overflow-x-auto border border-line">
                  <ProgressMatrix matrix={detail.matrix} from={FROM_DEVELOPMENT} />
                </div>
              </div>
              {detail.skills.length > 0 && (
                <div>
                  <h4 className={`${SECTION} mb-2`}>Skill breakdown</h4>
                  <div className="overflow-x-auto border border-line">
                    <SkillBreakdownTable
                      rows={detail.skills}
                      weeks={detail.matrix.weeks}
                      links={actionItemLinks(detail.matrix.issues)}
                      from={FROM_DEVELOPMENT}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          <div>
            <h4 className={`${SECTION} mb-2`}>Development plan</h4>
            <div className="flex flex-col gap-2.5">
              {agent.items.map((item) => (
                <PlanCard key={item.actionItemId} item={item} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One open action item. The badge says what is missing before it says what
 * the status is: an item with no root cause is not "open", it is waiting on
 * somebody to write one, and that is the thing to act on.
 */
function PlanCard({ item }: { item: DevelopmentRow["items"][number] }) {
  const footer = [
    item.trainingRequired && item.coachingRequired
      ? "training + coaching requested"
      : item.trainingRequired
        ? "training requested"
        : item.coachingRequired
          ? "coaching requested"
          : null,
    item.consecutivePassingWeeks > 0
      ? `${item.consecutivePassingWeeks}/${SUSTAINED_WEEKS} sustained weeks`
      : null,
  ].filter(Boolean);

  return (
    <div className="border border-line px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href={withReturn(`/records/${item.actionItemId}`, FROM_DEVELOPMENT)}
          className="text-[13px] font-bold text-ink underline-offset-4 transition hover:text-orange-brand hover:underline"
        >
          {item.kpiName}
        </Link>
        {!item.hasRca ? (
          <span className={`${CHIP} bg-fail-bg tracking-[0.06em] text-fail uppercase`}>RCA</span>
        ) : !item.hasActionPlan ? (
          <span className={`${CHIP} bg-warn-bg tracking-[0.06em] text-warn uppercase`}>Plan</span>
        ) : (
          <StatusBadge status={item.status} />
        )}
      </div>
      {/* The two lines are always both present, missing or not: a plan with
          no root cause under it should look unfinished, not tidy.

          Where there is something written, the line is the way to it —
          carrying its own underline rather than waiting for a hover, since
          the previous wording told the reader to open the item and then gave
          them nothing to click. The anchors land on the section itself: the
          record is long, and "recorded" is a promise about one part of it.
          Where nothing is written there is nothing to read, so the line stays
          plain rather than offering a link that leads to an empty section. */}
      <p className={`mt-2 text-xs leading-relaxed ${item.hasRca ? "text-muted" : "text-fail"}`}>
        <strong className="text-ink">RCA — </strong>
        {item.hasRca ? (
          <Link href={withReturn(`/records/${item.actionItemId}#rca`, FROM_DEVELOPMENT)} className={READ_LINK}>
            Recorded — read what the team leader wrote
          </Link>
        ) : (
          "Not yet recorded — the item cannot progress until the team leader writes this."
        )}
      </p>
      <p className={`mt-1.5 text-xs leading-relaxed ${item.hasActionPlan ? "text-muted" : "text-warn"}`}>
        <strong className="text-ink">Action plan — </strong>
        {item.hasActionPlan ? (
          <Link href={withReturn(`/records/${item.actionItemId}#action-plan`, FROM_DEVELOPMENT)} className={READ_LINK}>
            Written — read the plan
          </Link>
        ) : (
          "No action plan written yet."
        )}
      </p>
      {footer.length > 0 && <p className="mt-2 text-[11px] text-muted">{footer.join(" · ")}</p>}
    </div>
  );
}

/**
 * A link that looks like one before it is hovered. The plan card's two lines
 * read as prose, so the underline is what tells a reader the rest of the
 * root cause is a click away rather than somewhere else in the app.
 */
const READ_LINK =
  "font-semibold text-ink underline decoration-line underline-offset-4 transition hover:text-orange-brand hover:decoration-orange-brand";

/** The same tone the flat board gives a row's next step. */
function toneOf(urgency: number): string {
  if (urgency <= 1) return "text-fail";
  if (urgency <= 3) return "text-warn";
  return "text-muted";
}
