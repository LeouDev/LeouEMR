"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { CardHeader } from "@/components/ui";
import { collapsedStore, toggled } from "@/lib/ui/collapsed";

/**
 * A card whose header folds it away, remembering the choice.
 *
 * The ramp page is two large tables now — who is ramping today, and how
 * every cohort has progressed — and a reader is nearly always working in one
 * of them. Folding the other is the difference between scrolling past a
 * hundred rows and not.
 *
 * Read through a store rather than copied into state by an effect, the same
 * reason My Space's cards and the Development Hub's roster are: the server
 * has no localStorage, so it renders every card open and React folds the
 * saved ones at hydration. Seeding useState from storage would hydrate
 * markup the server never sent.
 */
export function CollapsibleCard({
  id,
  title,
  subtitle,
  action,
  children,
}: {
  /** Stable key this card is remembered under. */
  id: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const collapsed = useSyncExternalStore(
    collapsedStore.subscribe,
    collapsedStore.read,
    collapsedStore.serverRead,
  );
  const folded = collapsed.includes(id);

  return (
    <section className="overflow-hidden border-2 border-ink bg-surface">
      <div className="flex items-stretch justify-between gap-3 border-b-2 border-ink">
        <button
          type="button"
          aria-expanded={!folded}
          onClick={() => collapsedStore.save(toggled(collapsed, id))}
          className="flex min-w-0 flex-1 items-center gap-2.5 px-2 text-left transition hover:bg-cream"
        >
          <span
            aria-hidden="true"
            className={`inline-block w-[9px] shrink-0 text-xs text-muted transition-transform duration-[120ms] ${
              folded ? "" : "rotate-90"
            }`}
          >
            ▸
          </span>
          {/* The page's own header, so a folding card is not a different
              looking card. Its bottom border is the section's, above. */}
          <span className="min-w-0 flex-1 [&>div]:border-b-0">
            <CardHeader title={title} subtitle={subtitle} />
          </span>
        </button>
        {action && <div className="flex items-center pr-5">{action}</div>}
      </div>

      {!folded && children}
    </section>
  );
}
