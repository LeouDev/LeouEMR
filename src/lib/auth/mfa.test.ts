import { afterEach, describe, expect, it } from "vitest";
import { graceUntilSetting, mfaDecision, mfaExempt, mfaRequiredFor } from "./mfa";

describe("mfaRequiredFor", () => {
  it("covers everyone who sees a whole team, and not agents", () => {
    expect(mfaRequiredFor("admin")).toBe(true);
    expect(mfaRequiredFor("manager")).toBe(true);
    expect(mfaRequiredFor("supervisor")).toBe(true);
    expect(mfaRequiredFor("agent")).toBe(false);
  });
});

describe("mfaDecision", () => {
  const today = "2026-09-13";

  it("lets an agent through on a password alone", () => {
    expect(mfaDecision({ role: "agent", aal: "aal1", today })).toBe("ok");
  });

  it("lets a required role through once the second step is taken", () => {
    expect(mfaDecision({ role: "supervisor", aal: "aal2", today })).toBe("ok");
  });

  it("sends a required role on a password-only session to enrol", () => {
    expect(mfaDecision({ role: "manager", aal: "aal1", today })).toBe("enrol");
    expect(mfaDecision({ role: "admin", aal: null, today })).toBe("enrol");
  });

  it("only reminds while the deadline is ahead, and enforces from the day itself", () => {
    expect(mfaDecision({ role: "supervisor", aal: "aal1", today, graceUntil: "2026-09-20" })).toBe("grace");
    expect(mfaDecision({ role: "supervisor", aal: "aal1", today: "2026-09-20", graceUntil: "2026-09-20" })).toBe("enrol");
    expect(mfaDecision({ role: "supervisor", aal: "aal1", today, graceUntil: null })).toBe("enrol");
  });
});

describe("mfaExempt", () => {
  it("exempts the pages that get someone to the second step, and nothing under the shell", () => {
    expect(mfaExempt("/mfa")).toBe(true);
    expect(mfaExempt("/auth/confirm")).toBe(true);
    expect(mfaExempt("/reset-password")).toBe(true);
    expect(mfaExempt("/dashboard")).toBe(false);
    expect(mfaExempt("/mfa-not-really")).toBe(false);
  });
});

describe("graceUntilSetting", () => {
  const original = process.env.MFA_GRACE_UNTIL;
  afterEach(() => {
    if (original === undefined) delete process.env.MFA_GRACE_UNTIL;
    else process.env.MFA_GRACE_UNTIL = original;
  });

  it("reads a date and ignores anything else", () => {
    process.env.MFA_GRACE_UNTIL = "2026-09-20";
    expect(graceUntilSetting()).toBe("2026-09-20");
    process.env.MFA_GRACE_UNTIL = "next week";
    expect(graceUntilSetting()).toBeNull();
    delete process.env.MFA_GRACE_UNTIL;
    expect(graceUntilSetting()).toBeNull();
  });
});
