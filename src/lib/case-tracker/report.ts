import { summarizeDay, toCsv, type ActivityBlock, type DayProgress, type LoggedCase, type SkillTarget } from "./tracker";

/**
 * The files and the message an agent hands to their team lead at end of day.
 *
 * Built here rather than in the component so the report a supervisor receives
 * is covered by tests: it is the one output of this tool that leaves the
 * browser, and a wrong figure in it is a wrong figure in someone's inbox.
 */

const two = (n: number) => n.toFixed(2);

/** Header plus one row per case, in the column order the previous tool exported. */
export function caseLogCsv(entries: LoggedCase[], targets: Map<string, SkillTarget>): string {
  const rows: Array<Array<unknown>> = [
    [
      "Date",
      "PACaseNumber",
      "Skill",
      "Decision",
      "ProviderChecked",
      "MemberChecked",
      "DrugChecked",
      "ActiveApprovalOnFile",
      "CancellationNote",
      "Urgent",
      "QuantityLimitChecked",
      "LoggedAt",
    ],
  ];

  for (const entry of entries) {
    rows.push([
      entry.date,
      entry.caseNumber,
      targets.get(entry.skillCode ?? "")?.name ?? "",
      entry.decision,
      // Constant by construction — a case cannot be saved without all three
      // confirmed. Kept so the file a team lead already receives keeps its
      // columns rather than changing shape underneath them.
      "Y",
      "Y",
      "Y",
      entry.activeApproval,
      entry.cancellationNote,
      entry.urgent,
      entry.quantityLimit,
      entry.loggedAt,
    ]);
  }
  return toCsv(rows);
}

/** One row per date, oldest first. */
export function summaryCsv(
  dates: string[],
  blocks: ActivityBlock[],
  cases: LoggedCase[],
  targets: Map<string, SkillTarget>,
): string {
  const rows: Array<Array<unknown>> = [
    ["Date", "Cases", "Pend", "Deny", "Approved", "ProductionHours", "CasesPerHour", "TargetCases"],
  ];

  for (const date of [...dates].sort()) {
    const day = summarizeDay(date, blocks, cases, targets);
    const onDate = cases.filter((c) => c.date === date);
    rows.push([
      date,
      day.totalCases,
      onDate.filter((c) => c.decision === "Pend").length,
      onDate.filter((c) => c.decision === "Deny").length,
      onDate.filter((c) => c.decision === "Approved").length,
      two(day.totalHours),
      day.pace === null ? "" : two(day.pace),
      day.totalRequired === 0 ? "" : Math.ceil(day.totalRequired),
    ]);
  }
  return toCsv(rows);
}

/** The end-of-day message body, per-skill lines included. */
export function eodBody(day: DayProgress, yourName: string, tlName: string, readableDate: string): string {
  return [
    `Hi ${tlName},`,
    "",
    `Please see my End of Day report for ${readableDate}:`,
    "",
    `Cases completed: ${day.totalCases}`,
    `Production hours: ${two(day.totalHours)}`,
    `Cases per hour: ${day.pace === null ? "—" : two(day.pace)}`,
    `Target for the day: ${day.totalRequired === 0 ? "—" : `${Math.ceil(day.totalRequired)} cases`}`,
    ...day.skills.map(
      (skill) =>
        `  ${skill.skillName}: ${skill.cases} of ${Math.ceil(skill.required)} · ` +
        `${two(skill.hours)} hrs at ${skill.target}/hr` +
        (skill.rampStageLabel ? ` (ramp ${skill.rampStageLabel})` : ""),
    ),
    "",
    "Best regards,",
    yourName,
  ].join("\n");
}
