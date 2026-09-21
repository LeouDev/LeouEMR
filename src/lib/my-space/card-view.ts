import { BOXES, type BoxKey } from "./board";

/**
 * Which My Space cards the owner has collapsed.
 *
 * The page is five panels deep now and not everyone works in all of them:
 * a leader who never uses Let Go, or who wants the notepad out of the way
 * while working the boxes, should be able to fold one shut and have it stay
 * shut. Collapsing is remembered because it is a preference about how this
 * person likes their board, not where they happen to be in it — so
 * localStorage, unlike the Development Hub roster, which forgets when the
 * tab closes.
 *
 * Read through a store rather than copied into state by an effect, the same
 * way the roster's open rows and the Time & Motion panel's position are: the
 * server has no localStorage, so it renders every card open and React folds
 * the saved ones shut at hydration. Seeding useState from storage would
 * hydrate different markup than the server sent.
 *
 * Nothing collapsed is the default, so a board nobody has touched looks
 * exactly as it did before any of this existed.
 */

/** The four boxes and the notepad — every panel on the page. */
export type CardKey = BoxKey | "pad";

export const PAD_CARD: CardKey = "pad";

const CARDS: readonly CardKey[] = [...BOXES, PAD_CARD];

const KEY = "mySpaceCollapsedCards";

/**
 * A stored value is only a list of cards that exist. A key from an older
 * build, or a half-written value, folds nothing rather than throwing on a
 * page load.
 */
export function parseCollapsed(raw: string | null): CardKey[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((key): key is CardKey => CARDS.includes(key as CardKey));
  } catch {
    return [];
  }
}

/**
 * A card folded where it was open, opened where it was folded.
 *
 * Deliberately a local copy of the roster's helper of the same name rather
 * than an import across features: three lines, and the two have no reason
 * to move together.
 */
export function toggled(collapsed: readonly CardKey[], key: CardKey): CardKey[] {
  return collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key];
}

const listeners = new Set<() => void>();
let cache: { raw: string | null; value: CardKey[] } = { raw: null, value: [] };

function readRaw(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    // Private browsing or storage disabled — the cards still fold, they just
    // come back open next time.
    return null;
  }
}

export const cardViewStore = {
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  /**
   * Cached against the raw string so repeated reads return the same array.
   * useSyncExternalStore compares snapshots by identity and would loop for
   * ever on a fresh one every read.
   */
  read(): CardKey[] {
    const raw = readRaw();
    if (raw !== cache.raw) cache = { raw, value: parseCollapsed(raw) };
    return cache.value;
  },
  /** The server has nowhere to have saved one, so every card starts open. */
  serverRead(): CardKey[] {
    return [];
  },
  save(collapsed: CardKey[]): void {
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
