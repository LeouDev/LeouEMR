import { describe, expect, it } from "vitest";
import { describeSignupError, signupConflict } from "./signup-availability";

const nothing = { emails: [], employeeEids: [], msids: [] };

describe("signupConflict", () => {
  it("passes a sign-up nothing is registered against", () => {
    expect(signupConflict({ email: "a@optum.com", employeeEid: "001234567", msid: "abc1" }, nothing)).toBeNull();
  });

  it("names the email when an account row already carries it, whatever the case", () => {
    const why = signupConflict(
      { email: "Lary@Optum.com", employeeEid: "001234567", msid: "" },
      { ...nothing, emails: ["lary@optum.com"] },
    );
    expect(why).toMatch(/email address/);
    expect(why).toMatch(/administrator/);
  });

  it("names the employee ID when another account or profile holds it", () => {
    const why = signupConflict(
      { email: "new@optum.com", employeeEid: "001234567", msid: "" },
      { ...nothing, employeeEids: ["001234567"] },
    );
    expect(why).toMatch(/Employee ID 001234567/);
  });

  it("names the MSID case-insensitively and only when one was given", () => {
    const taken = { ...nothing, msids: ["ABCD123"] };
    expect(signupConflict({ email: "n@optum.com", employeeEid: "001234567", msid: "abcd123" }, taken)).toMatch(
      /MSID abcd123/,
    );
    expect(signupConflict({ email: "n@optum.com", employeeEid: "001234567", msid: "" }, taken)).toBeNull();
  });

  it("reports the email before the ID when both clash, since that is the account to sign in with", () => {
    const why = signupConflict(
      { email: "lary@optum.com", employeeEid: "001234567", msid: "" },
      { emails: ["lary@optum.com"], employeeEids: ["001234567"], msids: [] },
    );
    expect(why).toMatch(/email address/);
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
