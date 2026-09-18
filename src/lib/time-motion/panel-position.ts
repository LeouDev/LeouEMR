/**
 * Where the evaluator has dragged the Time & Motion panel to, kept in this
 * browser.
 *
 * Read through a store rather than copied into state by an effect, the same
 * reason the case tracker and the adherence scan are: the server has no
 * localStorage, so it renders the panel docked and React swaps the saved
 * place in on hydration. Seeding useState from storage would hydrate
 * different markup than the server sent.
 *
 * Saved because an evaluator works through audits one page load at a time —
 * a panel that went back to the corner after every submit would be dragged
 * back out twenty times a shift.
 */

export interface PanelPosition {
  x: number;
  y: number;
}

export interface Box {
  width: number;
  height: number;
}

const KEY = "timeMotionPanelPosition";

/** Enough of the panel to still be able to grab its header and drag it back. */
export const MIN_VISIBLE = 140;
/** The header's own height, so it can never be pushed below the fold. */
export const HEADER_HEIGHT = 44;

/**
 * Keeps a dragged panel reachable.
 *
 * Horizontally it may hang off either edge, but never so far that less than
 * `MIN_VISIBLE` of it is on screen — a panel dragged fully off is a panel
 * that cannot be dragged back. Vertically the top edge stays inside the
 * viewport, because the header is the handle and a handle below the fold is
 * the same problem.
 *
 * Applied on every drag frame and again whenever the window resizes: a
 * position that was fine on a second monitor must not strand the panel when
 * the laptop lid closes and the viewport shrinks under it.
 */
export function clampToViewport(pos: PanelPosition, panel: Box, viewport: Box): PanelPosition {
  const minX = Math.min(0, MIN_VISIBLE - panel.width);
  const maxX = Math.max(minX, viewport.width - MIN_VISIBLE);
  const maxY = Math.max(0, viewport.height - HEADER_HEIGHT);
  return {
    x: Math.round(Math.min(maxX, Math.max(minX, pos.x))),
    y: Math.round(Math.min(maxY, Math.max(0, pos.y))),
  };
}

/** A stored value is only a position if it is two real numbers. */
export function parsePosition(raw: string | null): PanelPosition | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { x, y } = parsed as Partial<PanelPosition>;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: x as number, y: y as number };
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
let cache: { raw: string | null; value: PanelPosition | null } = { raw: null, value: null };

function readRaw(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    // Private browsing or storage disabled — the panel still drags, it just
    // will not remember where to next time.
    return null;
  }
}

export const panelPositionStore = {
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  /** Cached against the raw string so repeated reads return the same object. */
  read(): PanelPosition | null {
    const raw = readRaw();
    if (raw !== cache.raw) cache = { raw, value: parsePosition(raw) };
    return cache.value;
  },
  /** The server has nowhere to have saved one, so the panel starts docked. */
  serverRead(): PanelPosition | null {
    return null;
  },
  save(pos: PanelPosition | null): void {
    try {
      if (pos) localStorage.setItem(KEY, JSON.stringify(pos));
      else localStorage.removeItem(KEY);
    } catch {
      // As above: unsaved is survivable, an exception here is not.
    }
    cache = { raw: pos ? JSON.stringify(pos) : null, value: pos };
    listeners.forEach((fn) => fn());
  },
};
