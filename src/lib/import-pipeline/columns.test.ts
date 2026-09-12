import { describe, expect, it } from "vitest";
import { normalizeEid, toText } from "./columns";

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
