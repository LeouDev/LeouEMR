import {
  IDENTITY_COLUMNS,
  parseWeekLabel,
  resolveColumns,
  toNumber,
  toText,
  type HeaderMap,
} from "./columns";
import {
  KPI_CODES,
  type AggregatedMetric,
  type KpiCode,
  type ParsedEmployee,
  type ParseResult,
  type QualityWeek,
  type SheetSummary,
  type SkillWeek,
  type ValidationIssue,
} from "./types";

export type SheetRows = Record<string, Array<Record<string, unknown>>>;

/** Sheets the pipeline consumes, matched case-insensitively. */
const SHEET_ALIASES: Record<string, string[]> = {
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
export function aggregateWorkbook(sheets: SheetRows): ParseResult {
  const issues: ValidationIssue[] = [];
  const summaries: SheetSummary[] = [];
  const employees = new Map<string, ParsedEmployee>();
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

      const consumed = consumeRow(canonical, row, cols, eid, week, {
        means,
        counts,
        cases,
        hours,
        present,
        expected,
        skillAcc,
        qualityAcc,
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
    { means, counts, cases, hours, present, expected, skillAcc, qualityAcc },
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
    metrics,
    skillWeeks: [...skillAcc.values()].filter((s) => s.hours > 0 && s.cases > 0),
    qualityWeeks: [...qualityAcc.values()],
    issues,
    sheets: summaries,
    weeks: [...weeks].sort(),
    unrecognizedSheets,
  };
}

/** Sheet-specific columns layered on top of the shared identity columns. */
const EXTRA_COLUMNS: Record<string, Record<string, string[]>> = {
  productivity: {
    cases: ["CASESCOMPLETED", "Cases Completed", "Prod Volume"],
    hours: ["PRODUCTIVITYHOUR", "Productivity Hour", "Prod Hours"],
    cphTarget: ["CPHTarget", "CPH Target", "Target"],
    ahtTarget: ["AHTTarget", "AHT Target"],
  },
  quality: {
    score: ["Score"],
    markdown: ["TotalMarkdown", "Markdown"],
  },
  nps: {
    nps: ["NPS"],
  },
  attendance: {
    present: ["PRESENT"],
    absent: ["ABSENT"],
    status: ["STATUS"],
  },
  feedback: {
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
      toText(cols.supervisorEid ? row[cols.supervisorEid] : undefined) ?? existing?.supervisorEid,
    managerName:
      toText(cols.managerName ? row[cols.managerName] : undefined) ?? existing?.managerName,
    site: toText(cols.site ? row[cols.site] : undefined) ?? existing?.site,
    skillType: toText(cols.skillType ? row[cols.skillType] : undefined) ?? existing?.skillType,
  };
  employees.set(eid, candidate);
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
}

function consumeRow(
  sheet: string,
  row: Record<string, unknown>,
  cols: HeaderMap,
  eid: string,
  week: { weekStart: string; weekEnd: string },
  acc: Accumulators,
): boolean {
  const weekStart = week.weekStart;
  switch (sheet) {
    case "productivity": {
      const caseCount = toNumber(cols.cases ? row[cols.cases] : undefined);
      const hourCount = toNumber(cols.hours ? row[cols.hours] : undefined);
      if (caseCount === null || hourCount === null) return false;

      const cphTarget = toNumber(cols.cphTarget ? row[cols.cphTarget] : undefined);
      const ahtTarget = toNumber(cols.ahtTarget ? row[cols.ahtTarget] : undefined);

      accumulate(acc.cases, eid, weekStart, KPI_CODES.CPH, caseCount, cphTarget);
      accumulate(acc.hours, eid, weekStart, KPI_CODES.CPH, hourCount);
      accumulate(acc.cases, eid, weekStart, KPI_CODES.AHT, caseCount, ahtTarget);
      accumulate(acc.hours, eid, weekStart, KPI_CODES.AHT, hourCount);

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
        target: undefined,
      };
      skill.cases += caseCount;
      skill.hours += hourCount;
      if (cphTarget !== null && Number.isFinite(cphTarget)) skill.target = cphTarget;
      acc.skillAcc.set(skillKey, skill);
      return true;
    }

    case "quality": {
      // Score is a 0-1 fraction per audit; the weekly KPI is its mean as a percentage.
      const score = toNumber(cols.score ? row[cols.score] : undefined);
      if (score === null) return false;
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
      return true;
    }

    case "nps": {
      // Each row is one survey scored 100 / 0 / -100; the mean is the NPS.
      const nps = toNumber(cols.nps ? row[cols.nps] : undefined);
      if (nps === null) return false;
      accumulate(acc.means, eid, weekStart, KPI_CODES.NPS, nps);
      return true;
    }

    case "attendance": {
      // One row per scheduled day. Attendance is days present out of days
      // the employee was expected in — OFF/PTO/LOA days are neither.
      const isPresent = toNumber(cols.present ? row[cols.present] : undefined) ?? 0;
      const isAbsent = toNumber(cols.absent ? row[cols.absent] : undefined) ?? 0;
      if (isPresent !== 1 && isAbsent !== 1) return false;

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
