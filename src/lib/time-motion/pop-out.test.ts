import { describe, expect, it } from "vitest";
import { styleCopiesFrom } from "./pop-out";

/** A same-origin sheet: its rules can be read. */
const readable = (href: string | null, ...rules: string[]) => ({
  href,
  get cssRules() {
    return rules.map((cssText) => ({ cssText }));
  },
});

/** A cross-origin sheet: touching cssRules throws, as the browser does. */
const blocked = (href: string | null) => ({
  href,
  get cssRules(): ArrayLike<{ cssText: string }> {
    throw new DOMException("cannot access rules", "SecurityError");
  },
});

describe("styleCopiesFrom", () => {
  it("copies a readable sheet rule by rule", () => {
    // Rule by rule rather than by URL, so the theme's custom properties and
    // its font faces travel with it — a pop-out window inherits nothing.
    expect(styleCopiesFrom([readable("/app.css", ":root{--bg:#f5f4f1}", ".btn{color:red}")])).toEqual([
      { kind: "inline", css: ":root{--bg:#f5f4f1}\n.btn{color:red}" },
    ]);
  });

  it("re-links a sheet it is not allowed to read", () => {
    // Google Fonts and anything else cross-origin: the new window fetches
    // it for itself.
    expect(styleCopiesFrom([blocked("https://fonts.googleapis.com/css2?family=Archivo")])).toEqual([
      { kind: "link", href: "https://fonts.googleapis.com/css2?family=Archivo" },
    ]);
  });

  it("skips a sheet that can be neither read nor linked", () => {
    // One unreachable stylesheet should cost some styling, not the window.
    expect(styleCopiesFrom([blocked(null)])).toEqual([]);
  });

  it("keeps the sheets in order, so later rules still win", () => {
    const copies = styleCopiesFrom([
      readable("/a.css", ".x{color:red}"),
      blocked("https://example.com/b.css"),
      readable("/c.css", ".x{color:blue}"),
    ]);

    expect(copies).toEqual([
      { kind: "inline", css: ".x{color:red}" },
      { kind: "link", href: "https://example.com/b.css" },
      { kind: "inline", css: ".x{color:blue}" },
    ]);
  });

  it("handles a document with no stylesheets at all", () => {
    expect(styleCopiesFrom([])).toEqual([]);
  });
});
