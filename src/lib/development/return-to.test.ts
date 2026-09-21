import { describe, expect, it } from "vitest";
import { FROM_DEVELOPMENT, FROM_RAMP, returnTo, withReturn } from "./return-to";

const LIST = { href: "/action-items", label: "← All action items" };

describe("returnTo", () => {
  it("sends a reader back where they came from", () => {
    expect(returnTo(FROM_DEVELOPMENT, LIST)).toEqual({
      href: "/development",
      label: "← Back to the development hub",
    });
  });

  it("sends the ramp panel's reader back to the ramp page", () => {
    expect(returnTo(FROM_RAMP, LIST)).toEqual({
      href: "/ramp",
      label: "← Back to the ramp progression",
    });
  });

  it("falls back to the page's own list when nothing said otherwise", () => {
    expect(returnTo(undefined, LIST)).toEqual(LIST);
    expect(returnTo("", LIST)).toEqual(LIST);
  });

  it("never lets the query string choose the destination", () => {
    // The whole reason this is a token and not a URL: a crafted `from` must
    // not be able to point the back link at another site, or anywhere else
    // in the app the linking page did not name.
    expect(returnTo("https://example.com", LIST)).toEqual(LIST);
    expect(returnTo("//example.com", LIST)).toEqual(LIST);
    expect(returnTo("/users", LIST)).toEqual(LIST);
    expect(returnTo("javascript:alert(1)", LIST)).toEqual(LIST);
    expect(returnTo("constructor", LIST)).toEqual(LIST);
  });
});

describe("withReturn", () => {
  it("adds the token to a plain path", () => {
    expect(withReturn("/records/abc", FROM_DEVELOPMENT)).toBe("/records/abc?from=development");
  });

  it("keeps the fragment after the query, where a browser expects it", () => {
    // `/records/abc#rca?from=…` would make the fragment "rca?from=…" and the
    // page would never see the token at all.
    expect(withReturn("/records/abc#rca", FROM_DEVELOPMENT)).toBe(
      "/records/abc?from=development#rca",
    );
  });

  it("joins onto a path that already carries a query", () => {
    expect(withReturn("/records/abc?print=1", FROM_DEVELOPMENT)).toBe(
      "/records/abc?print=1&from=development",
    );
  });

  it("leaves the href alone when there is nowhere to go back to", () => {
    expect(withReturn("/records/abc", undefined)).toBe("/records/abc");
  });
});
