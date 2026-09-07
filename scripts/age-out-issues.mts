/**
 * Closes action items that have outlived the 60-day threshold and whose KPI
 * has recovered.
 *
 * Same rule the engine applies on every import — see shouldAgeOut — run over
 * the backlog that accumulated before it existed. An item still failing is
 * never closed, however old: that is the case the queue exists to surface.
 *
 *   npm run age-out            # report only
 *   npm run age-out -- --apply
 */
import { ageOutStaleIssues } from "../src/lib/action-item-engine/persistence";

const apply = process.argv.includes("--apply");
console.log(`mode: ${apply ? "APPLY (will close)" : "dry run"}`);

const n = await ageOutStaleIssues(!apply);
console.log(
  apply
    ? `\nClosed ${n} action item${n === 1 ? "" : "s"} on age.`
    : `\n${n} action item${n === 1 ? "" : "s"} would be closed. Re-run with --apply.`,
);
process.exit(0);
