import { describe, expect, it } from "vitest";
import { emailDomain, parseDomainList, recipientAllowed } from "./recipients";

describe("parseDomainList", () => {
  it("splits, trims, lower-cases and drops a leading @", () => {
    expect(parseDomainList(" Optum.com, @uhg.com ,, ")).toEqual(["optum.com", "uhg.com"]);
    expect(parseDomainList(undefined)).toEqual([]);
  });
});

describe("emailDomain", () => {
  it("takes the part after the last @", () => {
    expect(emailDomain("Lead@Optum.com")).toBe("optum.com");
    expect(emailDomain("nobody")).toBeNull();
    expect(emailDomain("@optum.com")).toBeNull();
    expect(emailDomain("lead@")).toBeNull();
  });
});

describe("recipientAllowed", () => {
  const sender = "agent@optum.com";

  it("always allows the sender's own leaders, whatever their domain", () => {
    expect(
      recipientAllowed("Lead@Gmail.com", { allowedDomains: ["optum.com"], leaderEmails: ["lead@gmail.com"], senderEmail: sender }),
    ).toBe(true);
  });

  it("allows a company domain when domains are configured, and nothing else", () => {
    const context = { allowedDomains: ["optum.com", "uhg.com"], leaderEmails: [], senderEmail: sender };
    expect(recipientAllowed("someone@uhg.com", context)).toBe(true);
    expect(recipientAllowed("someone@optum.com.evil.test", context)).toBe(false);
    expect(recipientAllowed("someone@gmail.com", context)).toBe(false);
  });

  it("falls back to the sender's own domain when no domains are configured", () => {
    const context = { allowedDomains: [], leaderEmails: [], senderEmail: sender };
    expect(recipientAllowed("peer@optum.com", context)).toBe(true);
    expect(recipientAllowed("peer@gmail.com", context)).toBe(false);
  });

  it("never treats a public mail provider as a company domain, even when it is the sender's own or is listed", () => {
    const gmailSender = "agent@gmail.com";
    expect(recipientAllowed("anyone@gmail.com", { allowedDomains: [], leaderEmails: [], senderEmail: gmailSender })).toBe(false);
    expect(
      recipientAllowed("anyone@gmail.com", { allowedDomains: ["gmail.com"], leaderEmails: [], senderEmail: gmailSender }),
    ).toBe(false);
    // The sender's own leader on Gmail is still fine: matched by account, not by domain.
    expect(
      recipientAllowed("lead@gmail.com", { allowedDomains: [], leaderEmails: ["lead@gmail.com"], senderEmail: gmailSender }),
    ).toBe(true);
  });

  it("refuses an address with no domain", () => {
    expect(recipientAllowed("lead", { allowedDomains: [], leaderEmails: [], senderEmail: sender })).toBe(false);
  });
});
