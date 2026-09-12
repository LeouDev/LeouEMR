import { describe, expect, it } from "vitest";
import { describeSmtpFailure } from "./smtp-error";

const TARGET = { host: "smtp-relay.brevo.com", port: 587 };

function smtpError(code: string, response?: string): Error & { code: string; response?: string } {
  return Object.assign(new Error(response ?? code), { code, response });
}

describe("describeSmtpFailure", () => {
  it("points a refused sign-in at the credentials and quotes the relay", () => {
    const text = describeSmtpFailure(smtpError("EAUTH", "535 5.7.8 Authentication failed"), TARGET);
    expect(text).toContain("535 5.7.8 Authentication failed");
    expect(text).toContain("EOD_SMTP_USER");
  });

  it("names the host and port when the relay never answered", () => {
    expect(describeSmtpFailure(smtpError("ETIMEDOUT"), TARGET)).toContain("smtp-relay.brevo.com:587");
    expect(describeSmtpFailure(smtpError("ECONNECTION"), TARGET)).toContain("EOD_SMTP_PORT");
    expect(describeSmtpFailure(smtpError("EDNS"), TARGET)).toContain("EOD_SMTP_HOST");
  });

  it("passes on what the relay said about the addresses or the message", () => {
    expect(describeSmtpFailure(smtpError("EENVELOPE", "550 Sender not verified"), TARGET)).toContain(
      "550 Sender not verified",
    );
    expect(describeSmtpFailure(smtpError("EMESSAGE", "552 Message too large"), TARGET)).toContain(
      "552 Message too large",
    );
  });

  it("flattens and caps a long multi-line response", () => {
    const long = `554 5.7.1 ${"x".repeat(400)}\nsecond line`;
    const text = describeSmtpFailure(smtpError("EMESSAGE", long), TARGET);
    expect(text).not.toContain("\n");
    expect(text.length).toBeLessThan(260);
  });

  it("still says something useful for an error without a code", () => {
    expect(describeSmtpFailure(new Error("socket hang up"), TARGET)).toContain("socket hang up");
    expect(describeSmtpFailure(undefined, TARGET)).toMatch(/SMTP settings/);
  });
});
