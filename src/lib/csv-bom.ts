/**
 * Prefixed to a CSV file so Excel on Windows reads it as UTF-8 — without it
 * the dashes, the minus signs and any accented name open as mojibake.
 *
 * Applied where a file is handed over (a download, a mail attachment, a
 * route's response), never inside the functions that build the rows: the
 * same CSV string is also asserted in tests and, in the case tracker's own
 * exports, read back, and a byte-order mark has no business in either.
 *
 * Lives here rather than beside one feature's CSV helpers because both the
 * quality exports and the case tracker need it, and neither should have to
 * import from the other to get it.
 *
 * Spelled as an escape on purpose. Written as the character itself it is
 * indistinguishable from an empty string in a diff, a review or most
 * editors, and any formatter that strips zero-width characters would empty
 * it with nothing failing.
 */
export const CSV_BOM = "\u{FEFF}";
