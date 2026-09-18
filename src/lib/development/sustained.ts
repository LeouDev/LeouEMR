/**
 * Weeks of sustained passing required to close an issue (spec section 26).
 *
 * Its own module, and not in `queries/development.ts` where it used to
 * live, for the reason kpi-groups.ts and team/columns.ts spell out: a
 * client component that imports a value from a query module imports the
 * query module — and with it the database client, the cache and the Node
 * built-ins none of which exist in a browser. The roster is a client
 * component and needs this number; a type from that module would have been
 * fine, since types are erased, but a constant is not.
 *
 * `queries/development.ts` re-exports it, so every reader that already
 * imports it from there still can.
 */
export const SUSTAINED_WEEKS = 4;
