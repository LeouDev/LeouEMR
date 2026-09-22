/**
 * Which foldable sections a reader has folded away, kept in this browser.
 *
 * The third place this pattern has been needed — the Development Hub's open
 * rows, My Space's cards, and now the ramp page's two tables — so it is
 * written once here rather than a fourth time. The other two keep their own
 * stores for now; this one is where anything new should go.
 *
 * localStorage rather than the tab's own: a fold is how a person likes a
 * page laid out, not where they happen to be in it, and it should still be
 * that way tomorrow.
 *
 * Read through a store rather than copied into state by an effect. The
 * server has no localStorage, so it renders every section open and React
 * folds the saved ones at hydration; seeding useState from storage would
 * hydrate different markup than the server sent.
 *
 * Ids are namespaced by their page ("my-space:notes") so two pages cannot
 * fold each other's sections by sharing a name.
 */

const KEY = "collapsedSections";

/** A stored value is only a list of ids; anything else folds nothing. */
export function parseCollapsed(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

/** A section folded where it was open, opened where it was folded. */
export function toggled(collapsed: readonly string[], id: string): string[] {
  return collapsed.includes(id) ? collapsed.filter((k) => k !== id) : [...collapsed, id];
}

const listeners = new Set<() => void>();
let cache: { raw: string | null; value: string[] } = { raw: null, value: [] };

function readRaw(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    // Private browsing or storage disabled — sections still fold, they just
    // come back open next time.
    return null;
  }
}

export const collapsedStore = {
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  /**
   * Cached against the raw string so repeated reads return the same array:
   * useSyncExternalStore compares snapshots by identity and would loop for
   * ever on a fresh one every read.
   */
  read(): string[] {
    const raw = readRaw();
    if (raw !== cache.raw) cache = { raw, value: parseCollapsed(raw) };
    return cache.value;
  },
  /** The server has nowhere to have saved one, so everything starts open. */
  serverRead(): string[] {
    return [];
  },
  save(collapsed: string[]): void {
    const raw = JSON.stringify(collapsed);
    cache = { raw, value: collapsed };
    try {
      localStorage.setItem(KEY, raw);
    } catch {
      // Unwritable storage costs the preference, not the page.
    }
    for (const fn of listeners) fn();
  },
};
