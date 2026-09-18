/**
 * The Time & Motion panel as its own always-on-top window, through the
 * Document Picture-in-Picture API.
 *
 * A panel inside the page cannot leave the page: it is a positioned
 * element, and no amount of dragging takes it onto a second monitor or over
 * the recording player the evaluator is listening in. This opens a real
 * operating-system window instead, which can go anywhere and stays above
 * everything — which is what "detach it" actually asked for.
 *
 * Chromium only (Chrome and Edge 116+). Firefox and Safari have no such
 * API, so the button that opens it is not offered there rather than
 * offered and inert.
 */

/** The slice of the API this uses. TypeScript's DOM library does not carry it yet. */
interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
  readonly window: Window | null;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

export function popOutSupported(): boolean {
  return typeof window !== "undefined" && typeof window.documentPictureInPicture?.requestWindow === "function";
}

/** Roughly the panel's own width, and tall enough for five segments and the controls. */
export const POP_OUT_SIZE = { width: 480, height: 640 };

export type StyleCopy = { kind: "inline"; css: string } | { kind: "link"; href: string };

interface StyleSheetLike {
  href: string | null;
  cssRules?: ArrayLike<{ cssText: string }>;
}

/**
 * How to reproduce the page's styles inside another document.
 *
 * A picture-in-picture window is a blank document: it inherits nothing, so
 * without this the panel arrives as unstyled HTML. Same-origin sheets are
 * copied rule by rule, which carries the theme's custom properties and the
 * font faces along with everything else. A cross-origin sheet cannot be
 * read at all — touching `cssRules` throws — so it is re-linked by URL and
 * the new window fetches it itself.
 *
 * A sheet that is neither readable nor linkable is skipped rather than
 * thrown on: one unreachable stylesheet should cost some styling, not the
 * whole window.
 */
export function styleCopiesFrom(sheets: ArrayLike<StyleSheetLike>): StyleCopy[] {
  const out: StyleCopy[] = [];
  for (const sheet of Array.from(sheets)) {
    try {
      const rules = sheet.cssRules;
      if (!rules) throw new Error("no rules");
      out.push({ kind: "inline", css: Array.from(rules).map((rule) => rule.cssText).join("\n") });
    } catch {
      if (sheet.href) out.push({ kind: "link", href: sheet.href });
    }
  }
  return out;
}

/** Writes the page's styles into `target`, which is another document's head. */
export function applyStyles(target: Document, copies: StyleCopy[]): void {
  for (const copy of copies) {
    if (copy.kind === "inline") {
      const style = target.createElement("style");
      style.textContent = copy.css;
      target.head.appendChild(style);
    } else {
      const link = target.createElement("link");
      link.rel = "stylesheet";
      link.href = copy.href;
      target.head.appendChild(link);
    }
  }
}

/**
 * Opens the window and dresses it: the page's styles, the app's own
 * background, and a title that says what it is in the window switcher.
 *
 * Throws when the browser refuses — no user gesture behind the call, or a
 * pop-out already open — and the caller says so rather than failing quietly.
 */
export async function openPopOut(): Promise<Window> {
  const api = window.documentPictureInPicture;
  if (!api) throw new Error("This browser cannot open a pop-out window.");

  const pip = await api.requestWindow(POP_OUT_SIZE);
  pip.document.title = "Time & Motion";
  applyStyles(pip.document, styleCopiesFrom(document.styleSheets));
  // The panel's own markup assumes the app's ground under it; a bare
  // picture-in-picture document is transparent white.
  pip.document.body.style.margin = "0";
  pip.document.body.style.background = "var(--surface, #ffffff)";
  pip.document.body.classList.add("font-sans");
  return pip;
}
