import Link from "next/link";
import { MboGauge } from "@/components/charts";
import type { MboNode } from "@/lib/queries/analytics";

/**
 * MBO attainment as a collapsible site → manager → supervisor → employee tree.
 *
 * Built on <details>, so it expands without client JavaScript. Sites open by
 * default because site-then-manager is the level being read; managers stay
 * closed so a large site does not unfold hundreds of agents at once.
 */

/** Chevron width plus its gap — the inset a leaf adds to align with branches. */
const CHEVRON = 20;

function Summary({ node, depth }: { node: MboNode; depth: number }) {
  const label =
    depth === 0 ? "site" : depth === 1 ? "manager" : depth === 2 ? "supervisor" : "";

  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4">
      <span className="min-w-0">
        <span
          className={`block truncate ${depth === 0 ? "text-sm font-semibold text-ink"
              : depth === 1
                ? "text-sm font-medium text-ink"
                : "text-sm text-ink"
          }`}
        >
          {node.label}
        </span>
        {label && (
          <span className="text-[10px] tracking-wide text-muted uppercase">
            {label} · {node.headcount} {node.headcount === 1 ? "person" : "people"}
          </span>
        )}
      </span>

      <span className="hidden text-right text-xs text-muted sm:block">
        {node.scored > 0 ? `${node.passing}/${node.scored} passing` : "no score"}
      </span>

      <MboGauge value={node.passRate} />
    </div>
  );
}

function Node({ node, depth }: { node: MboNode; depth: number }) {
  // Indent is an inline value rather than a class because a leaf needs the
  // branch indent plus the width of the chevron it does not draw, so its
  // label lines up with its siblings'.
  const indent = 16 + depth * 20;

  // Leaves are employees: no disclosure triangle, just a link to the person.
  if (node.children.length === 0) {
    return (
      <div
        style={{ paddingLeft: indent + CHEVRON }}
        className="border-t border-line/60 py-2 pr-4"
      >
        {node.employeeId ? (
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4">
            <span className="min-w-0">
              <Link
                href={`/employees/${node.employeeId}`}
                    prefetch={false}
                className="block truncate text-sm text-ink underline-offset-4 hover:text-orange-brand hover:underline"
              >
                {node.label}
              </Link>
              <span className="font-mono text-[10px] text-muted">{node.eid}</span>
            </span>
            <span className="hidden text-right text-xs text-muted sm:block">
              {node.scored > 0 ? (node.passing ? "pass" : "fail") : "no score"}
            </span>
            <MboGauge value={node.passRate} />
          </div>
        ) : (
          <Summary node={node} depth={depth} />
        )}
      </div>
    );
  }

  return (
    <details open={depth < 1} className="group border-t border-line/60">
      <summary
        style={{ paddingLeft: indent }}
        className="flex cursor-pointer list-none items-center gap-2 py-2.5 pr-4 transition hover:bg-cream/60 [&::-webkit-details-marker]:hidden"
      >
        <svg
          aria-hidden
          viewBox="0 0 12 12"
          className="h-3 w-3 shrink-0 text-muted transition-transform group-open:rotate-90"
        >
          <path d="M4 2.5 8 6l-4 3.5" fill="none" stroke="currentColor" strokeWidth={1.6} />
        </svg>
        <div className="min-w-0 flex-1">
          <Summary node={node} depth={depth} />
        </div>
      </summary>
      <div className="bg-cream/30">
        {node.children.map((child) => (
          <Node key={`${child.label}-${child.employeeId ?? ""}`} node={child} depth={depth + 1} />
        ))}
      </div>
    </details>
  );
}

export function MboTree({ sites }: { sites: MboNode[] }) {
  if (sites.length === 0) {
    return <p className="px-6 py-8 text-center text-sm text-muted">No employees in this scope.</p>;
  }

  return (
    <div className="border-b border-line/60">
      {sites.map((site) => (
        <Node key={site.label} node={site} depth={0} />
      ))}
    </div>
  );
}
