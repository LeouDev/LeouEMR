import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./return-path";

describe("safeReturnPath", () => {
  it("keeps a same-site path, query included", () => {
    expect(safeReturnPath("/pto?month=2026-11&view=cluster")).toBe("/pto?month=2026-11&view=cluster");
  });

  it("falls back to the dashboard when nothing was asked for", () => {
    expect(safeReturnPath(null)).toBe("/dashboard");
    expect(safeReturnPath("")).toBe("/dashboard");
  });

  it("never leaves the site", () => {
    expect(safeReturnPath("https://evil.test/login")).toBe("/dashboard");
    expect(safeReturnPath("//evil.test")).toBe("/dashboard");
    expect(safeReturnPath("/\\evil.test")).toBe("/dashboard");
    expect(safeReturnPath("javascript:alert(1)")).toBe("/dashboard");
    expect(safeReturnPath("/pto\n")).toBe("/dashboard");
  });
});
