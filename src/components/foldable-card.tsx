"use client";

import { useSyncExternalStore } from "react";
import { collapsedStore, toggled } from "@/lib/ui/collapsed";

/**
 * A card whose body folds away behind its header, remembering the fold in
 * this browser (src/lib/ui/collapsed.ts). `defaultOpen` says how it starts;
 * the store holds the ids a reader has toggled away from that default, so
 * a card that starts folded opens for the person who opened it and stays
 * open for them tomorrow.
 *
 * The body stays in the page when folded, only hidden — and shown again in
 * print, where a fold is a preference the paper should not inherit.
 */
export function FoldableCard({
  id,
  title,
  subtitle,
  summary,
  defaultOpen = true,
  className = "",
  children,
}: {
  /** Namespaced by page, e.g. "action-item:timeline". */
  id: string;
  title: string;
  subtitle?: string;
  /** What the folded card still says, e.g. "12 weeks · 0 passing". */
  summary?: string;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const flipped = useSyncExternalStore(collapsedStore.subscribe, collapsedStore.read, collapsedStore.serverRead);
  const open = defaultOpen !== flipped.includes(id);
  const bodyId = `foldable-${id.replace(/[^a-z0-9]+/gi, "-")}`;

  return (
    <div className={`overflow-hidden border-2 border-ink bg-surface ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-ink px-6 py-4">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => collapsedStore.save(toggled(collapsedStore.read(), id))}
          className="flex items-start gap-2.5 text-left print:pointer-events-none"
        >
          <span
            aria-hidden="true"
            className={`mt-1 inline-block w-[9px] text-sm text-muted transition-transform duration-[120ms] ${open ? "rotate-90" : ""} print:hidden`}
          >
            ▸
          </span>
          <span>
            <span className="block text-base font-bold text-ink">{title}</span>
            {subtitle && <span className="mt-1 block text-sm text-muted">{subtitle}</span>}
          </span>
        </button>
        <span className="text-sm text-muted">
          {summary}
          <span className="ml-3 text-xs font-semibold text-ink print:hidden">{open ? "Hide" : "Show"}</span>
        </span>
      </div>
      <div id={bodyId} className={open ? "" : "hidden print:block"}>
        {children}
      </div>
    </div>
  );
}
