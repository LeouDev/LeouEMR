import {
  IDENTITY_COLUMNS,
  parseWeekLabel,
  resolveColumns,
  toNumber,
  normalizeEid,
  toText,
  type HeaderMap,
} from "./columns";
import {
  KPI_CODES,
  type AggregatedMetric,
  type KpiCode,
  type ParsedEmployee,
  type ParsedOrgWeek,
  type ParseResult,
  type MetricFact,
  type NpsFact,
  type QualityFact,
  type QualityWeek,
  type SheetSummary,
  type SkillFact,
  type SkillWeek,
  type ValidationIssue,
} from "./types";
import { classifyResponse } from "@/lib/kpi-engine/nps";
import type { RampTargets } from "./par-scoring";

export type SheetRows = Record<string, Array<Record<string, unknown>>>;

/** Skill label (normalized) to the formula that skill is measured by. */
export type SkillMetrics = Map<string, "cph" | "aht" | "case_rate">;

/** Matches a source skill label to a configured skill, ignoring case and punctuation. */
function normalizeSkillLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Sheets the pipeline consumes, matched case-insensitively. */
export const SHEET_ALIASES: Record<string, string[]> = {
  productivity: ["productivity"],
  quality: ["quality"],
  nps: ["nps"],
  attendance: ["attendance"],
  feedback: ["feedback"],
};

interface Accumulator {
  sum: number;
  count: number;
  targetSum: number;
  targetCount: number;
}

/** Keyed by `${eid}|${weekStart}|${kpiCode}`. */
type AccumulatorMap = Map<string, Accumulator>;

function accumulate(
  map: AccumulatorMap,
  eid: string,
  weekStart: string,
  kpi: KpiCode,
  value: number,
  target?: number | null,
) {
  const key = `${eid}|${weekStart}|${kpi}`;
  const existing = map.get(key) ?? { sum: 0, count: 0, targetSum: 0, targetCount: 0 };
  existing.sum += value;
  existing.count += 1;
  if (target !== null && target !== undefined && Number.isFinite(target)) {
    existing.targetSum += target;
    existing.targetCount += 1;
  }
  map.set(key, existing);
}

/**
 * Turns the workbook's transactional rows into one value per
 * (employee, week, KPI).
 *
 * Every sheet is a different grain — daily production records, per-audit
 * quality rows, per-survey NPS rows, per-day attendance rows, per-incident
 * compliance rows — so each is rolled up on its own terms rather than
 * through one generic path.
 */
export function aggregateWorkbook(
  sheets: SheetRows,
  skillMetrics?: SkillMetrics,
  rampTargets?: RampTargets,
): ParseResult {
  const issues: ValidationIssue[] = [];
  const summaries: SheetSummary[] = [];
  const employees = new Map<string, ParsedEmployee>();
  // `${eid}|${weekStart}` -> the structure that week's rows stated. Later rows
  // for the same week win, matching how the roster itself resolves conflicts.
  const orgWeeks = new Map<string, ParsedOrgWeek>();
  const weeks = new Set<string>();

  // Per-KPI accumulators. Ratios that can't be averaged directly (CPH, AHT,
  // attendance) accumulate their numerator and denominator separately.
  const means: AccumulatorMap = new Map(); // QUALITY, NPS
  const counts: AccumulatorMap = new Map(); // CRITICAL_ERRORS
  const cases: AccumulatorMap = new Map(); // productivity numerator
  const hours: AccumulatorMap = new Map(); // productivity denominator
  const present: AccumulatorMap = new Map();
  const expected: AccumulatorMap = new Map();
  const weekRange = new Map<string, string>(); // weekStart -> weekEnd

  // PAR/MBO inputs, keyed separately because they roll up differently.
  const skillAcc = new Map<string, SkillWeek>(); // `${eid}|${week}|${skill}`
  const qualityAcc = new Map<string, QualityWeek>(); // `${eid}|${week}`

  // Daily facts, so any reporting period can be re-aggregated from source
  // grain rather than averaged from weekly values.
  const metricFactAcc = new Map<string, MetricFact>();
  const skillFactAcc = new Map<string, SkillFact>();
  const qualityFactAcc = new Map<string, QualityFact>();
  const npsFactAcc = new Map<string, NpsFact>();

  const resolvedSheets = matchSheets(sheets);

  for (const [canonical, sheetName] of Object.entries(resolvedSheets)) {
    const rows = sheets[sheetName];
    if (!rows?.length) continue;

    const headers = Object.keys(rows[0]);
    let used = 0;
    let skipped = 0;
    let missingEid = 0;
    let missingWeek = 0;

    const cols = resolveColumns(headers, {
      ...IDENTITY_COLUMNS,
      ...EXTRA_COLUMNS[canonical],
    });

    for (const row of rows) {
      const eid = toText(cols.eid ? row[cols.eid] : undefined);
      const week = parseWeekLabel(cols.week ? row[cols.week] : undefined);

      if (!eid) {
        missingEid += 1;
        skipped += 1;
        continue;
      }
      if (!week) {
        missingWeek += 1;
        skipped += 1;
        continue;
      }

      weeks.add(week.weekStart);
      weekRange.set(week.weekStart, week.weekEnd);
      captureEmployee(employees, eid, row, cols);
      captureOrgWeek(orgWeeks, eid, week, row, cols);

      const consumed = consumeRow(canonical, row, cols, eid, week, skillMetrics, rampTargets, {
        means,
        counts,
        cases,
        hours,
        present,
        expected,
        skillAcc,
        qualityAcc,
        metricFactAcc,
        skillFactAcc,
        qualityFactAcc,
        npsFactAcc,
      });

      if (consumed) used += 1;
      else skipped += 1;
    }

    summaries.push({ sheet: sheetName, rowsRead: rows.length, rowsUsed: used, rowsSkipped: skipped });

    if (missingEid > 0) {
      issues.push({
        severity: "error",
        sheet: sheetName,
        message: "Rows missing an employee ID were skipped",
        count: missingEid,
      });
    }
    if (missingWeek > 0) {
      issues.push({
        severity: "error",
        sheet: sheetName,
        message: "Rows with an unreadable week label were skipped",
        count: missingWeek,
      });
    }
  }

  const metrics = buildMetrics(
    { means, counts, cases, hours, present, expected, skillAcc, qualityAcc,
      metricFactAcc, skillFactAcc, qualityFactAcc, npsFactAcc },
    weekRange,
  );

  const missingSheets = Object.keys(SHEET_ALIASES).filter((key) => !resolvedSheets[key]);
  for (const sheet of missingSheets) {
    issues.push({
      severity: "warning",
      sheet,
      message: `No "${sheet}" sheet found — its KPIs will not be imported`,
      count: 0,
    });
  }

  const recognized = new Set(Object.values(resolvedSheets));
  const unrecognizedSheets = Object.keys(sheets).filter((name) => !recognized.has(name));

  return {
    employees: [...employees.values()],
    orgWeeks: [...orgWeeks.values()],
    metrics,
    skillWeeks: [...skillAcc.values()].filter((s) => s.hours > 0 && s.cases > 0),
    qualityWeeks: [...qualityAcc.values()],
    metricFacts: [...metricFactAcc.values()],
    skillFacts: [...skillFactAcc.values()],
    qualityFacts: [...qualityFactAcc.values()],
    npsFacts: [...npsFactAcc.values()],
    issues,
    sheets: summaries,
    weeks: [...weeks].sort(),
    unrecognizedSheets,
  };
}

/** Sheet-specific columns layered on top of the shared identity columns. */
const EXTRA_COLUMNS: Record<string, Record<string, string[]>> = {
  productivity: {
    factDate: ["DATECOMPLETED", "Date Completed"],
    cases: ["CASESCOMPLETED", "Cases Completed", "Prod Volume"],
    hours: ["PRODUCTIVITYHOUR", "Productivity Hour", "Prod Hours"],
    weightHours: ["IEX Prod Hours", "IEX Hours", "ProdHrs"],
    prodWeight: ["Prod Weight", "ProdWeight"],
    cphTarget: ["CPHTarget", "CPH Target", "Target"],
    ahtTarget: ["AHTTarget", "AHT Target"],
  },
  quality: {
    factDate: ["Date"],
    score: ["Score"],
    markdown: ["TotalMarkdown", "Markdown"],
  },
  nps: {
    factDate: ["Date"],
    nps: ["NPS"],
  },
  attendance: {
    factDate: ["Date"],
    present: ["PRESENT"],
    absent: ["ABSENT"],
    status: ["STATUS"],
  },
  feedback: {
    factDate: ["Error Date", "Date"],
    risk: ["ComplianceRisk", "Compliance Risk"],
  },
};

function matchSheets(sheets: SheetRows): Record<string, string> {
  const matched: Record<string, string> = {};
  const names = Object.keys(sheets);

  for (const [canonical, aliases] of Object.entries(SHEET_ALIASES)) {
    const found = names.find((name) =>
      aliases.some((alias) => name.trim().toLowerCase() === alias),
    );
    if (found) matched[canonical] = found;
  }
  return matched;
}

function captureEmployee(
  employees: Map<string, ParsedEmployee>,
  eid: string,
  row: Record<string, unknown>,
  cols: HeaderMap,
) {
  const existing = employees.get(eid);
  const candidate: ParsedEmployee = {
    eid,
    name: toText(cols.name ? row[cols.name] : undefined) ?? existing?.name ?? eid,
    supervisorName:
      toText(cols.supervisorName ? row[cols.supervisorName] : undefined) ??
      existing?.supervisorName,
    supervisorEid:
      normalizeEid(cols.supervisorEid ? row[cols.supervisorEid] : undefined) ?? existing?.supervisorEid,
    managerName:
      toText(cols.managerName ? row[cols.managerName] : undefined) ?? existing?.managerName,
    site: toText(cols.site ? row[cols.site] : undefined) ?? existing?.site,
    skillType: toText(cols.skillType ? row[cols.skillType] : undefined) ?? existing?.skillType,
  };
  employees.set(eid, candidate);
}

/**
 * Records the org structure a single weekly row states.
 *
 * Deliberately does not inherit from a previous week the way `captureEmployee`
 * inherits from a previous row: a blank supervisor this week means this week's
 * rows did not say, and carrying last week's value forward would invent a
 * continuity the file never claimed. The splice treats an unstated week as an
 * absence of information rather than a move.
 */
function captureOrgWeek(
  orgWeeks: Map<string, ParsedOrgWeek>,
  eid: string,
  week: { weekStart: string; weekEnd: string },
  row: Record<string, unknown>,
  cols: HeaderMap,
) {
  const supervisorEid = normalizeEid(cols.supervisorEid ? row[cols.supervisorEid] : undefined) ?? null;
  const supervisorName = toText(cols.supervisorName ? row[cols.supervisorName] : undefined) ?? null;
  const managerName = toText(cols.managerName ? row[cols.managerName] : undefined) ?? null;
  const site = toText(cols.site ? row[cols.site] : undefined) ?? null;

  // A sheet that carries no org columns at all must not overwrite what a sheet
  // that does carry them already recorded for this week.
  if (!supervisorEid && !supervisorName && !managerName && !site) return;

  orgWeeks.set(`${eid}|${week.weekStart}`, {
    eid,
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    supervisorEid,
    supervisorName,
    managerName,
    site,
  });
}

interface Accumulators {
  means: AccumulatorMap;
  counts: AccumulatorMap;
  cases: AccumulatorMap;
  hours: AccumulatorMap;
  present: AccumulatorMap;
  expected: AccumulatorMap;
  skillAcc: Map<string, SkillWeek>;
  qualityAcc: Map<string, QualityWeek>;
  metricFactAcc: Map<string, MetricFact>;
  skillFactAcc: Map<string, SkillFact>;
  qualityFactAcc: Map<string, QualityFact>;
  npsFactAcc: Map<string, NpsFact>;
}

/** Accumulates one day's numerator and denominator for a measured KPI. */
function addMetricFact(
  acc: Map<string, MetricFact>,
  eid: string,
  kpiCode: KpiCode,
  factDate: string | null,
  numerator: number,
  denominator: number,
) {
  if (!factDate) return;
  const key = `${eid}|${kpiCode}|${factDate}`;
  const existing = acc.get(key) ?? {
    eid, kpiCode, factDate, numerator: 0, denominator: 0, sampleSize: 0,
  };
  existing.numerator += numerator;
  existing.denominator += denominator;
  existing.sampleSize += 1;
  acc.set(key, existing);
}

/** Reads a cell as an ISO date, accepting Date objects and Excel serials. */
function readDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = toText(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function consumeRow(
  sheet: string,
  row: Record<string, unknown>,
  cols: HeaderMap,
  eid: string,
  week: { weekStart: string; weekEnd: string },
  skillMetrics: SkillMetrics | undefined,
  rampTargets: RampTargets | undefined,
  acc: Accumulators,
): boolean {
  const weekStart = week.weekStart;
  switch (sheet) {
    case "productivity": {
      const caseCount = toNumber(cols.cases ? row[cols.cases] : undefined);
      const hourCount = toNumber(cols.hours ? row[cols.hours] : undefined);
      if (caseCount === null || hourCount === null) return false;

      const factDate = readDate(cols.factDate ? row[cols.factDate] : undefined);
      const rowSkill = toText(cols.skillType ? row[cols.skillType] : undefined);

      // A ramp assignment overrides whatever target the row itself supplies
      // — the whole point is that a supervisor's ramp setup, not a manually
      // maintained column in the source file, decides a new hire's target.
      // Someone with no active ramp assignment is unaffected: the row's own
      // target (or the skill's steady default, further downstream) still
      // applies exactly as it always has.
      const ramp = rowSkill ? rampTargets?.get(`${eid}|${weekStart}|${normalizeSkillLabel(rowSkill)}`) : undefined;
      const cphTarget = ramp?.cphTarget ?? toNumber(cols.cphTarget ? row[cols.cphTarget] : undefined);
      const ahtTarget = ramp?.ahtTarget ?? toNumber(cols.ahtTarget ? row[cols.ahtTarget] : undefined);

      /**
       * Only score the KPI that matches how this skill is actually measured.
       *
       * Cases and hours exist on every production row, so both cases-per-hour
       * and seconds-per-case can always be computed — but only one of them is
       * what the business rates that skill on. Emitting both gave a
       * cases-per-hour agent an average handle time derived from work that is
       * not handle time, and opened action items against it.
       *
       * Skills measured by case rate are scored through the PAR production
       * rate instead, so they take neither.
       *
       * An unrecognised skill keeps both, since dropping data for a label we
       * simply have not mapped yet would hide it rather than correct it.
       */
      const metric = rowSkill ? skillMetrics?.get(normalizeSkillLabel(rowSkill)) : undefined;
      const scoresCph = metric === undefined ? true : metric === "cph";
      const scoresAht = metric === undefined ? true : metric === "aht";

      if (scoresCph) {
        addMetricFact(acc.metricFactAcc, eid, KPI_CODES.CPH, factDate, caseCount, hourCount);
        accumulate(acc.cases, eid, weekStart, KPI_CODES.CPH, caseCount, cphTarget);
        accumulate(acc.hours, eid, weekStart, KPI_CODES.CPH, hourCount);
      }
      if (scoresAht) {
        addMetricFact(acc.metricFactAcc, eid, KPI_CODES.AHT, factDate, caseCount, hourCount);
        accumulate(acc.cases, eid, weekStart, KPI_CODES.AHT, caseCount, ahtTarget);
        accumulate(acc.hours, eid, weekStart, KPI_CODES.AHT, hourCount);
      }

      // Per-skill totals for PAR/MBO scoring. The target comes from the row
      // because the source carries per-employee targets (ramping agents have
      // lower ones) that must not be replaced by the skill's default.
      const skillType = toText(cols.skillType ? row[cols.skillType] : undefined) ?? "Unspecified";
      const skillKey = `${eid}|${weekStart}|${skillType}`;
      const skill = acc.skillAcc.get(skillKey) ?? {
        eid,
        weekStart,
        weekEnd: week.weekEnd,
        skillType,
        cases: 0,
        hours: 0,
        weightHours: 0,
        prodWeight: 0,
        cphTarget: undefined,
        ahtTarget: undefined,
      };
      const weightHourCount = toNumber(cols.weightHours ? row[cols.weightHours] : undefined);
      skill.cases += caseCount;
      skill.hours += hourCount;
      skill.weightHours += weightHourCount ?? hourCount;
      skill.prodWeight += toNumber(cols.prodWeight ? row[cols.prodWeight] : undefined) ?? 0;
      if (cphTarget !== null && Number.isFinite(cphTarget)) skill.cphTarget = cphTarget;
      if (ahtTarget !== null && Number.isFinite(ahtTarget)) skill.ahtTarget = ahtTarget;
      acc.skillAcc.set(skillKey, skill);

      if (factDate) {
        const factKey = `${eid}|${skillType}|${factDate}`;
        const fact = acc.skillFactAcc.get(factKey) ?? {
          eid, skillLabel: skillType, factDate, cases: 0, hours: 0, weightHours: 0, prodWeight: 0,
        };
        fact.cases += caseCount;
        fact.hours += hourCount;
        fact.weightHours += weightHourCount ?? hourCount;
        fact.prodWeight += toNumber(cols.prodWeight ? row[cols.prodWeight] : undefined) ?? 0;
        acc.skillFactAcc.set(factKey, fact);
      }
      return true;
    }

    case "quality": {
      // Score is a 0-1 fraction per audit; the weekly KPI is its mean as a percentage.
      const score = toNumber(cols.score ? row[cols.score] : undefined);
      if (score === null) return false;
      const qDate = readDate(cols.factDate ? row[cols.factDate] : undefined);
      addMetricFact(acc.metricFactAcc, eid, KPI_CODES.QUALITY, qDate, score, 1);
      accumulate(acc.means, eid, weekStart, KPI_CODES.QUALITY, score * 100);

      // Audit tallies for DPU and DPO, split by skill because DPO weights
      // each record by its own skill's attribute count.
      const markdown = toNumber(cols.markdown ? row[cols.markdown] : undefined) ?? 0;
      const auditSkill =
        toText(cols.skillType ? row[cols.skillType] : undefined) ?? "Unspecified";

      const qualityKey = `${eid}|${weekStart}`;
      const tally = acc.qualityAcc.get(qualityKey) ?? {
        eid,
        weekStart,
        weekEnd: week.weekEnd,
        bySkill: {},
      };
      const skillTally = tally.bySkill[auditSkill] ?? { audits: 0, imperfect: 0, markdowns: 0 };
      skillTally.audits += 1;
      if (score < 1) skillTally.imperfect += 1;
      skillTally.markdowns += markdown;
      tally.bySkill[auditSkill] = skillTally;
      acc.qualityAcc.set(qualityKey, tally);

      if (qDate) {
        const factKey = `${eid}|${auditSkill}|${qDate}`;
        const fact = acc.qualityFactAcc.get(factKey) ?? {
          eid, skillLabel: auditSkill, factDate: qDate, audits: 0, imperfect: 0, markdowns: 0,
        };
        fact.audits += 1;
        if (score < 1) fact.imperfect += 1;
        fact.markdowns += markdown;
        acc.qualityFactAcc.set(factKey, fact);
      }
      return true;
    }

    case "nps": {
      // Each row is one survey scored 100 / 0 / -100; the mean is the NPS.
      const nps = toNumber(cols.nps ? row[cols.nps] : undefined);
      if (nps === null) return false;
      const npsDate = readDate(cols.factDate ? row[cols.factDate] : undefined);
      addMetricFact(acc.metricFactAcc, eid, KPI_CODES.NPS, npsDate, nps, 1);
      accumulate(acc.means, eid, weekStart, KPI_CODES.NPS, nps);

      // Tally the mix alongside the score: promoters, passives and
      // detractors cannot be separated out of the score later.
      if (npsDate) {
        const key = `${eid}|${npsDate}`;
        const fact = acc.npsFactAcc.get(key) ?? {
          eid, factDate: npsDate, promoters: 0, passives: 0, detractors: 0,
        };
        const category = classifyResponse(nps);
        if (category === "promoter") fact.promoters += 1;
        else if (category === "detractor") fact.detractors += 1;
        else fact.passives += 1;
        acc.npsFactAcc.set(key, fact);
      }
      return true;
    }

    case "attendance": {
      // One row per scheduled day. Attendance is days present out of days
      // the employee was expected in — OFF/PTO/LOA days are neither.
      const isPresent = toNumber(cols.present ? row[cols.present] : undefined) ?? 0;
      const isAbsent = toNumber(cols.absent ? row[cols.absent] : undefined) ?? 0;
      if (isPresent !== 1 && isAbsent !== 1) return false;

      addMetricFact(acc.metricFactAcc, eid, KPI_CODES.ATTENDANCE,
        readDate(cols.factDate ? row[cols.factDate] : undefined), isPresent === 1 ? 1 : 0, 1);
      accumulate(acc.present, eid, weekStart, KPI_CODES.ATTENDANCE, isPresent === 1 ? 1 : 0);
      accumulate(acc.expected, eid, weekStart, KPI_CODES.ATTENDANCE, 1);
      return true;
    }

    case "feedback": {
      // One row per compliance incident; only critical ones count against the
      // KPI. The severity is expressed either as a label ("Critical IO") or
      // as a 0/1 flag depending on which column the sheet supplies, so both
      // forms are accepted rather than assuming one.
      const raw = cols.risk ? row[cols.risk] : undefined;
      const numeric = toNumber(raw);
      const label = toText(raw);
      if (numeric === null && !label) return false;

      const isCritical =
        numeric !== null ? numeric === 1 : label!.toLowerCase().includes("critical");
      addMetricFact(acc.metricFactAcc, eid, KPI_CODES.CRITICAL_ERRORS,
        readDate(cols.factDate ? row[cols.factDate] : undefined), isCritical ? 1 : 0, 1);
      accumulate(acc.counts, eid, weekStart, KPI_CODES.CRITICAL_ERRORS, isCritical ? 1 : 0);
      return true;
    }

    default:
      return false;
  }
}

function buildMetrics(acc: Accumulators, weekRange: Map<string, string>): AggregatedMetric[] {
  const metrics: AggregatedMetric[] = [];

  const push = (
    key: string,
    actualValue: number,
    sampleSize: number,
    targetValue?: number,
  ) => {
    const [eid, weekStart, kpiCode] = key.split("|");
    const weekEnd = weekRange.get(weekStart);
    if (!weekEnd || !Number.isFinite(actualValue)) return;
    metrics.push({
      eid,
      kpiCode: kpiCode as never,
      weekStart,
      weekEnd,
      actualValue,
      targetValue,
      sampleSize,
    });
  };

  for (const [key, value] of acc.means) {
    if (value.count === 0) continue;
    push(key, value.sum / value.count, value.count);
  }

  for (const [key, value] of acc.counts) {
    push(key, value.sum, value.count);
  }

  // CPH = total cases / total hours; AHT = seconds per case. Both are ratios
  // of weekly totals, never an average of daily ratios.
  for (const [key, caseAcc] of acc.cases) {
    const hourAcc = acc.hours.get(key);
    if (!hourAcc || hourAcc.sum <= 0 || caseAcc.sum <= 0) continue;

    const averageTarget =
      caseAcc.targetCount > 0 ? caseAcc.targetSum / caseAcc.targetCount : undefined;

    if (key.endsWith(KPI_CODES.CPH)) {
      push(key, caseAcc.sum / hourAcc.sum, caseAcc.count, averageTarget);
    } else if (key.endsWith(KPI_CODES.AHT)) {
      push(key, (hourAcc.sum / caseAcc.sum) * 3600, caseAcc.count, averageTarget);
    }
  }

  for (const [key, presentAcc] of acc.present) {
    const expectedAcc = acc.expected.get(key);
    if (!expectedAcc || expectedAcc.sum <= 0) continue;
    push(key, (presentAcc.sum / expectedAcc.sum) * 100, expectedAcc.sum);
  }

  return metrics;
}
