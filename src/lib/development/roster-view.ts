/**
 * Which rows of the Development Hub roster are open, for the length of this
 * tab's visit.
 *
 * The roster is three levels deep and the reading it supports is a drill:
 * open a manager, open a team leader, open an agent, then follow a failing
 * figure into the item behind it. Following that link is a page navigation,
 * and a navigation replaces the page — so coming back landed on a collapsed
 * roster, and a reader working through one team had to dig down again for
 * every item they opened.
 *
 * Read through a store rather than copied into state by an effect, the same
 * way the Time & Motion panel's position is: the server has no
 * sessionStorage, so it renders the roster closed and React swaps the open
 * rows in at hydration. Seeding useState from storage would hydrate
 * different markup than the server sent.
 *
 * sessionStorage rather than localStorage, deliberately. This is where you
 * were a moment ago, not a preference — it should survive following a link
 * and coming back, and it should not still be waiting tomorrow, or in the
 * tab opened to look at something else.
 */

/** The open rows, by the keys the roster identifies them with. */
export interface RosterView {
  /** Manager names. */
  managers: string[];
  /** Team leader names. */
  leads: string[];
  /** Employee ids — a name is not unique enough to reopen the right row. */
  agents: string[];
}

export const CLOSED: RosterView = { managers: [], leads: [], agents: [] };

const KEY = "developmentRosterView";

function names(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * A stored value is only a view if it is three lists of strings. Anything
 * else — a half-written value, a shape from an older build — reads as a
 * closed roster rather than throwing on a page load.
 */
export function parseView(raw: string | null): RosterView {
  if (!raw) return CLOSED;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return CLOSED;
    const { managers, leads, agents } = parsed as Partial<RosterView>;
    return { managers: names(managers), leads: names(leads), agents: names(agents) };
  } catch {
    return CLOSED;
  }
}

/** A key added where it was absent, removed where it was there. */
export function toggled(open: readonly string[], key: string): string[] {
  return open.includes(key) ? open.filter((k) => k !== key) : [...open, key];
}

const listeners = new Set<() => void>();
let cache: { raw: string | null; value: RosterView } = { raw: null, value: CLOSED };

function readRaw(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    // Private browsing or storage disabled — the roster still opens and
    // closes, it just will not remember where you were after a link.
    return null;
  }
}

export const rosterViewStore = {
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  /**
   * Cached against the raw string so repeated reads return the same object.
   * useSyncExternalStore compares snapshots by identity and would loop for
   * ever on a fresh object every read.
   */
  read(): RosterView {
    const raw = readRaw();
    if (raw !== cache.raw) cache = { raw, value: parseView(raw) };
    return cache.value;
  },
  /** The server has nowhere to have saved one, so the roster starts closed. */
  serverRead(): RosterView {
    return CLOSED;
  },
  save(view: RosterView): void {
    const raw = JSON.stringify(view);
    cache = { raw, value: view };
    try {
      sessionStorage.setItem(KEY, raw);
    } catch {
      // Unwritable storage costs the reader their place, not the page.
    }
    for (const fn of listeners) fn();
  },
};
