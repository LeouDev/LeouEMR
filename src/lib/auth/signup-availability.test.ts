import { describe, expect, it } from "vitest";
import {
  SIGNUP_TAKEN_MESSAGE,
  describeSignupError,
  signupConflict,
  signupDomainAllowed,
  signupDomainMessage,
} from "./signup-availability";

const nothing = { emails: [], employeeEids: [], msids: [] };

describe("signupConflict", () => {
  it("passes a sign-up nothing is registered against", () => {
    expect(signupConflict({ email: "a@optum.com", employeeEid: "001234567", msid: "abc1" }, nothing)).toBeNull();
  });

  it("refuses an email an account already carries, whatever the case, without saying which detail clashed", () => {
    const why = signupConflict(
      { email: "Lary@Optum.com", employeeEid: "001234567", msid: "" },
      { ...nothing, emails: ["lary@optum.com"] },
    );
    expect(why).toBe(SIGNUP_TAKEN_MESSAGE);
    expect(why).not.toMatch(/email/i);
  });

  it("refuses an employee ID another account or profile holds, with the same message", () => {
    const why = signupConflict(
      { email: "new@optum.com", employeeEid: "001234567", msid: "" },
      { ...nothing, employeeEids: ["001234567"] },
    );
    expect(why).toBe(SIGNUP_TAKEN_MESSAGE);
    expect(why).not.toMatch(/001234567/);
  });

  it("refuses a taken MSID case-insensitively, and only when one was given", () => {
    const taken = { ...nothing, msids: ["ABCD123"] };
    expect(signupConflict({ email: "n@optum.com", employeeEid: "001234567", msid: "abcd123" }, taken)).toBe(
      SIGNUP_TAKEN_MESSAGE,
    );
    expect(signupConflict({ email: "n@optum.com", employeeEid: "001234567", msid: "" }, taken)).toBeNull();
  });
});

describe("signupDomainAllowed", () => {
  it("allows anything when no domains are configured", () => {
    expect(signupDomainAllowed("anyone@gmail.com", [])).toBe(true);
  });

  it("allows only the configured domains, case-insensitively, and never a look-alike", () => {
    const domains = ["optum.com", "uhg.com"];
    expect(signupDomainAllowed("Lary@Optum.com", domains)).toBe(true);
    expect(signupDomainAllowed("lary@uhg.com", domains)).toBe(true);
    expect(signupDomainAllowed("lary@optum.com.evil.test", domains)).toBe(false);
    expect(signupDomainAllowed("lary@gmail.com", domains)).toBe(false);
    expect(signupDomainAllowed("lary", domains)).toBe(false);
  });

  it("tells the person which domains are accepted", () => {
    expect(signupDomainMessage(["optum.com", "uhg.com"])).toBe(
      "Sign up with your company email address (@optum.com or @uhg.com).",
    );
  });
});

describe("describeSignupError", () => {
  it("replaces Supabase's bare database error with an actionable message", () => {
    expect(describeSignupError("Database error saving new user")).toMatch(/administrator/);
  });

  it("leaves every other message alone", () => {
    expect(describeSignupError("Password should be at least 6 characters")).toBe(
      "Password should be at least 6 characters",
    );
  });
});
