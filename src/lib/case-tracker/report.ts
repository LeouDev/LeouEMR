import {
  progressPercent,
  summarizeDay,
  toCsv,
  type ActivityBlock,
  type DayProgress,
  type LoggedCase,
  type SkillTarget,
} from "./tracker";

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
    ["Date", "Cases", "Pend", "Deny", "Approved", "Cancel", "ProductionHours", "CasesPerHour", "TargetCases"],
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
      onDate.filter((c) => c.decision === "Cancel").length,
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

/**
 * Escapes the five characters that matter inside HTML text or a
 * double-quoted attribute. `yourName` and `tlName` are free text an agent
 * typed into a browser field — the only untrusted strings this template
 * ever places into markup — so every place either lands gets this first.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Hex, not the app's CSS custom properties — mail clients do not resolve `var()`. */
const EMAIL_COLOR = {
  navy: "#0b1f3a",
  ink: "#10203a",
  muted: "#5a6478",
  rule: "#e2e0dc",
  cream: "#f5f4f1",
  surface: "#ffffff",
  orange: "#f26522",
  pass: "#12674c",
  passBg: "#dcece6",
  warn: "#9a6410",
  warnBg: "#f7ebd8",
  fail: "#a8321f",
  failBg: "#f6e0dc",
} as const;

const EMAIL_FONT =
  "font-family: Archivo, 'Segoe UI', Helvetica, Arial, sans-serif;";
const EMAIL_MONO = "font-family: 'Courier New', Courier, monospace;";

/**
 * The same end-of-day figures as `eodBody`, laid out as a self-contained
 * HTML document instead of plain text.
 *
 * `mailto:` — what actually sends this today — only ever carries a plain
 * text body, so this is not wired into that flow; it exists to be reviewed,
 * and later pasted into a client that accepts rich paste (Gmail and Outlook
 * web both keep formatting from a copied HTML block) or sent through an
 * actual mail API. Built with table layout and inline styles throughout,
 * not the app's own CSS, because that is what the mail clients on the other
 * end of an EOD report — Outlook chief among them — actually render
 * reliably.
 */
export function eodHtml(day: DayProgress, yourName: string, tlName: string, readableDate: string): string {
  const percent = progressPercent(day);
  const barColor = day.totalHours === 0 ? EMAIL_COLOR.muted : day.met ? EMAIL_COLOR.pass : percent >= 60 ? EMAIL_COLOR.warn : EMAIL_COLOR.fail;

  const stat = (label: string, value: string, last: boolean) => `
                  <td width="25%" valign="top" style="padding:16px 12px; text-align:center; ${last ? "" : `border-right:2px solid ${EMAIL_COLOR.ink};`}">
                    <p style="margin:0; font-size:10px; font-weight:700; letter-spacing:1px; color:${EMAIL_COLOR.orange}; text-transform:uppercase; ${EMAIL_FONT}">${label}</p>
                    <p style="margin:6px 0 0; font-size:22px; font-weight:800; color:${EMAIL_COLOR.ink}; ${EMAIL_MONO}">${value}</p>
                  </td>`;

  const skillRows = day.skills
    .map((skill) => {
      const paceColor = skill.hours === 0 ? EMAIL_COLOR.muted : skill.met ? EMAIL_COLOR.pass : EMAIL_COLOR.fail;
      const needsBg = skill.met ? EMAIL_COLOR.passBg : EMAIL_COLOR.cream;
      const needsColor = skill.met ? EMAIL_COLOR.pass : EMAIL_COLOR.ink;
      const needsText = skill.met ? "Met" : `${skill.remaining} short`;
      return `
                <tr>
                  <td style="padding:9px 10px; font-size:13px; color:${EMAIL_COLOR.ink}; border-bottom:1px solid ${EMAIL_COLOR.rule}; ${EMAIL_FONT}">
                    ${escapeHtml(skill.skillName)}${skill.rampStageLabel ? ` <span style="font-size:10px; font-weight:700; color:${EMAIL_COLOR.ink}; background-color:${EMAIL_COLOR.cream}; padding:2px 5px;">RAMP · ${escapeHtml(skill.rampStageLabel)}</span>` : ""}
                  </td>
                  <td align="right" style="padding:9px 10px; font-size:13px; color:${EMAIL_COLOR.ink}; border-bottom:1px solid ${EMAIL_COLOR.rule}; ${EMAIL_MONO}">${skill.cases} / ${Math.ceil(skill.required)}</td>
                  <td align="right" style="padding:9px 10px; font-size:13px; color:${EMAIL_COLOR.muted}; border-bottom:1px solid ${EMAIL_COLOR.rule}; ${EMAIL_MONO}">${two(skill.hours)}h @ ${skill.target}/hr</td>
                  <td align="right" style="padding:9px 10px; font-size:11px; font-weight:700; text-transform:uppercase; color:${needsColor}; background-color:${needsBg}; border-bottom:1px solid ${EMAIL_COLOR.rule};">${needsText}</td>
                </tr>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>End of Day Report</title>
</head>
<body style="margin:0; padding:0; background-color:${EMAIL_COLOR.cream};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${EMAIL_COLOR.cream};">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px; max-width:100%; background-color:${EMAIL_COLOR.surface}; border:2px solid ${EMAIL_COLOR.ink};">

<tr><td style="background-color:${EMAIL_COLOR.navy}; padding:22px 28px;">
  <p style="margin:0; font-size:11px; font-weight:700; letter-spacing:2px; color:${EMAIL_COLOR.orange}; text-transform:uppercase; ${EMAIL_FONT}">End of Day Report</p>
  <p style="margin:6px 0 0; font-size:20px; font-weight:800; color:${EMAIL_COLOR.cream}; ${EMAIL_FONT}">${escapeHtml(readableDate)}</p>
</td></tr>

<tr><td style="padding:24px 28px 4px;">
  <p style="margin:0; font-size:14px; color:${EMAIL_COLOR.ink}; ${EMAIL_FONT}">Hi ${escapeHtml(tlName)},</p>
  <p style="margin:8px 0 0; font-size:14px; color:${EMAIL_COLOR.ink}; ${EMAIL_FONT}">Please see my End of Day report for ${escapeHtml(readableDate)}:</p>
</td></tr>

<tr><td style="padding:18px 28px 6px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; border:2px solid ${EMAIL_COLOR.ink};">
    <tr>${stat("Cases", String(day.totalCases), false)}${stat("Prod. hours", two(day.totalHours), false)}${stat("Cases/hr", day.pace === null ? "—" : two(day.pace), false)}${stat("Target", day.totalRequired === 0 ? "—" : String(Math.ceil(day.totalRequired)), true)}</tr>
  </table>
</td></tr>

<tr><td style="padding:6px 28px 20px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px solid ${EMAIL_COLOR.ink};">
    <tr style="height:14px;">
      <td width="${Math.round(percent)}%" style="background-color:${barColor}; font-size:1px; line-height:1px;">&nbsp;</td>
      <td style="background-color:${EMAIL_COLOR.cream}; font-size:1px; line-height:1px;">&nbsp;</td>
    </tr>
  </table>
  <p style="margin:8px 0 0; font-size:12px; color:${EMAIL_COLOR.muted}; ${EMAIL_FONT}">
    ${
      day.totalHours === 0
        ? "No production hours logged today."
        : day.met
          ? `On target — ${day.totalCases} of ${Math.ceil(day.totalRequired)} cases.`
          : `${day.remaining} more case${day.remaining === 1 ? "" : "s"} to hit ${Math.ceil(day.totalRequired)}.`
    }
  </p>
</td></tr>

${
  day.skills.length > 0
    ? `<tr><td style="padding:0 28px 20px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; border:2px solid ${EMAIL_COLOR.ink};">
    <tr style="background-color:${EMAIL_COLOR.cream};">
      <th align="left" style="padding:8px 10px; font-size:10px; font-weight:700; letter-spacing:1px; color:${EMAIL_COLOR.ink}; text-transform:uppercase; border-bottom:2px solid ${EMAIL_COLOR.ink}; ${EMAIL_FONT}">Skill</th>
      <th align="right" style="padding:8px 10px; font-size:10px; font-weight:700; letter-spacing:1px; color:${EMAIL_COLOR.ink}; text-transform:uppercase; border-bottom:2px solid ${EMAIL_COLOR.ink}; ${EMAIL_FONT}">Cases</th>
      <th align="right" style="padding:8px 10px; font-size:10px; font-weight:700; letter-spacing:1px; color:${EMAIL_COLOR.ink}; text-transform:uppercase; border-bottom:2px solid ${EMAIL_COLOR.ink}; ${EMAIL_FONT}">Pace</th>
      <th align="right" style="padding:8px 10px; font-size:10px; font-weight:700; letter-spacing:1px; color:${EMAIL_COLOR.ink}; text-transform:uppercase; border-bottom:2px solid ${EMAIL_COLOR.ink}; ${EMAIL_FONT}">Status</th>
    </tr>
    ${skillRows}
  </table>
</td></tr>`
    : ""
}

<tr><td style="padding:4px 28px 28px;">
  <p style="margin:0; font-size:14px; color:${EMAIL_COLOR.ink}; ${EMAIL_FONT}">Best regards,</p>
  <p style="margin:4px 0 0; font-size:14px; font-weight:700; color:${EMAIL_COLOR.ink}; ${EMAIL_FONT}">${escapeHtml(yourName)}</p>
</td></tr>

<tr><td style="padding:14px 28px; background-color:${EMAIL_COLOR.cream}; border-top:2px solid ${EMAIL_COLOR.ink};">
  <p style="margin:0; font-size:11px; color:${EMAIL_COLOR.muted}; ${EMAIL_FONT}">Sent from the PA case tracker — kept in the browser, not imported into any system of record.</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
