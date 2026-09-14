import { describe, expect, it } from "vitest";
import { normalizeEid, parseMonthLabel, toText } from "./columns";

describe("normalizeEid", () => {
  it("pads an all-digit EID to nine digits", () => {
    expect(normalizeEid(1305110)).toBe("001305110");
    expect(normalizeEid("1305110")).toBe("001305110");
    expect(normalizeEid("001305110")).toBe("001305110");
  });

  it("keeps anything that is not purely digits as written", () => {
    expect(normalizeEid("AB-12345")).toBe("AB-12345");
    expect(normalizeEid("1234567890")).toBe("1234567890");
  });

  it("treats blanks and dashes as no value, like toText", () => {
    expect(normalizeEid("")).toBeNull();
    expect(normalizeEid("-")).toBeNull();
    expect(normalizeEid(undefined)).toBeNull();
    expect(toText("  ")).toBeNull();
  });
});

describe("parseMonthLabel", () => {
  it("reads the shapes a month column is typed in", () => {
    expect(parseMonthLabel("2026-09")).toBe("2026-09-01");
    expect(parseMonthLabel("2026/09")).toBe("2026-09-01");
    expect(parseMonthLabel("09/2026")).toBe("2026-09-01");
    expect(parseMonthLabel("9/15/2026")).toBe("2026-09-01");
    expect(parseMonthLabel("2026-09-15")).toBe("2026-09-01");
    expect(parseMonthLabel("Sep-2026")).toBe("2026-09-01");
    expect(parseMonthLabel("September 2026")).toBe("2026-09-01");
    expect(parseMonthLabel("2026 September")).toBe("2026-09-01");
    expect(parseMonthLabel("Sept 26")).toBe("2026-09-01");
  });

  it("reads a real date cell as its month", () => {
    expect(parseMonthLabel(new Date(Date.UTC(2026, 8, 30)))).toBe("2026-09-01");
  });

  it("rejects what it cannot place rather than guessing", () => {
    expect(parseMonthLabel("")).toBeNull();
    expect(parseMonthLabel(null)).toBeNull();
    expect(parseMonthLabel("Q3")).toBeNull();
    expect(parseMonthLabel("2026-13")).toBeNull();
    expect(parseMonthLabel("Steady")).toBeNull();
    expect(parseMonthLabel(202609)).toBeNull();
  });
});
