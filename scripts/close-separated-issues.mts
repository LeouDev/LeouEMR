/**
 * Closes the open action items of everyone who has already left.
 *
 * Same sweep the engine runs at the end of every import — see
 * closeIssuesOfSeparated — over the backlog of people tagged in the EWS or
 * dropped from a roster before a separation closed their work by itself.
 * Someone whose separation date is still ahead keeps their work.
 *
 *   npm run close-separated            # report only
 *   npm run close-separated -- --apply
 */
import { closeIssuesOfSeparated } from "../src/lib/action-item-engine/persistence";

const apply = process.argv.includes("--apply");
console.log(`mode: ${apply ? "APPLY (will close)" : "dry run"}`);

const n = await closeIssuesOfSeparated(!apply);
console.log(
  apply
    ? `\nClosed ${n} action item${n === 1 ? "" : "s"} of people who have left.`
    : `\n${n} action item${n === 1 ? "" : "s"} would be closed. Re-run with --apply.`,
);
process.exit(0);
