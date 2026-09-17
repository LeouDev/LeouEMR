/**
 * An audit's header block for display: the fields the form asks for now,
 * plus anything it used to ask for that this audit actually carries.
 *
 * `qa_audits.header_values` is keyed by field key, and every place that
 * shows it — the history panel, the raw-data export — walks the form's
 * current `headerFields`. So retiring a field does not delete the values
 * filed under it; it makes them invisible, which is worse. The AV, MPA and
 * Fax forms swapped Call Reason for Tech Decision, and every audit filed
 * before that would have silently lost the one header it recorded.
 *
 * Nothing already filed moves — the same rule the scoring changes follow.
 *
 * Deliberately a plain module with no "use client": the history panel is a
 * client component and the export runs on the server, and both need this.
 */

/**
 * Keys no form asks for any more, and what they were called.
 *
 * Spelled out rather than derived from the key, so a past audit reads with
 * the label the evaluator actually saw. "(retired)" is on purpose: without
 * it, two audits of the same form appear to disagree about which headers
 * exist, and the reader has no way to tell why.
 */
export const RETIRED_HEADER_LABELS: Record<string, string> = {
  callReason: "Call Reason (retired)",
};

export interface HeaderRow {
  label: string;
  value: string;
}

/**
 * The current fields first, in form order, then any retired value this audit
 * holds.
 *
 * Takes only the key and label a field carries, not the whole
 * `QaHeaderField`: the history panel narrows its rows to those two on the
 * server before they cross into the client, and this has no use for the rest.
 */
export function headerRows(
  fields: Array<{ key: string; label: string }>,
  values: Record<string, string>,
): HeaderRow[] {
  const current = new Set(fields.map((field) => field.key));
  const rows: HeaderRow[] = fields
    .map((field) => ({ label: field.label, value: values[field.key] ?? "" }))
    .filter((row) => row.value !== "");

  for (const [key, value] of Object.entries(values)) {
    if (current.has(key) || !value) continue;
    // A key nobody recognises is still shown under its raw name: losing a
    // recorded value is the failure this exists to prevent, and an odd
    // label is a smaller problem than a missing row.
    rows.push({ label: RETIRED_HEADER_LABELS[key] ?? key, value });
  }
  return rows;
}
