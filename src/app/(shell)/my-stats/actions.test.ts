import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/auth/session";

/**
 * sendEodEmail relays an already-built report to SMTP — it must not touch
 * the network without real configuration, must never let a bad recipient
 * address or a rejected send escape as an unhandled exception (a server
 * action that throws surfaces to the caller as a generic failure screen,
 * not the specific message a sender could act on), and the From/Reply-To
 * split matters: Gmail (and most providers) reject a From that is not the
 * authenticated mailbox, so only Reply-To may carry the agent's own address.
 */

const currentUser = vi.hoisted(() => ({ value: null as CurrentUser | null }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => currentUser.value }));

const sendMail = vi.hoisted(() => vi.fn((opts: Record<string, unknown>) => Promise.resolve(opts)));
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail })) },
}));

const USER: CurrentUser = {
  id: "agent-1",
  email: "kristian.reyes@example.test",
  name: "Reyes, Kristian",
  role: "agent",
  status: "active",
  employeeEid: "001895123",
  managerName: null,
};

const REPORT = {
  tlEmail: "lead@example.test",
  subject: "EOD Report (September 8, 2026) - Reyes, Kristian",
  html: "<html><body>report</body></html>",
  text: "Cases completed: 12",
};

const SMTP_KEYS = ["EOD_SMTP_HOST", "EOD_SMTP_PORT", "EOD_SMTP_USER", "EOD_SMTP_PASS", "EOD_SMTP_FROM"] as const;

afterEach(() => {
  for (const key of SMTP_KEYS) delete process.env[key];
});

describe("sendEodEmail — no session", () => {
  it("refuses before looking at SMTP configuration at all", async () => {
    currentUser.value = null;
    vi.resetModules();
    const { sendEodEmail } = await import("./actions");
    expect(await sendEodEmail(REPORT)).toEqual({ ok: false, error: "Not signed in" });
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe("sendEodEmail — SMTP not set up", () => {
  it("reports that sending isn't configured rather than throwing", async () => {
    currentUser.value = USER;
    vi.resetModules();
    const { sendEodEmail } = await import("./actions");
    const result = await sendEodEmail(REPORT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("isn't configured");
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe("sendEodEmail — configured", () => {
  beforeEach(() => {
    currentUser.value = USER;
    process.env.EOD_SMTP_HOST = "smtp.gmail.com";
    process.env.EOD_SMTP_PORT = "465";
    process.env.EOD_SMTP_USER = "sender@gmail.com";
    process.env.EOD_SMTP_PASS = "an-app-password";
    sendMail.mockClear();
    sendMail.mockResolvedValue({});
  });

  it("rejects a malformed recipient address before ever calling SMTP", async () => {
    vi.resetModules();
    const { sendEodEmail } = await import("./actions");
    const result = await sendEodEmail({ ...REPORT, tlEmail: "not-an-email" });
    expect(result.ok).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("sends from the authenticated mailbox and replies to the agent, not the shared mailbox", async () => {
    vi.resetModules();
    const { sendEodEmail } = await import("./actions");
    const result = await sendEodEmail(REPORT);
    expect(result).toEqual({ ok: true });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const call = sendMail.mock.calls[0][0];
    expect(call.from).toContain("sender@gmail.com");
    expect(call.from).toContain("Reyes, Kristian");
    expect(call.replyTo).toBe("kristian.reyes@example.test");
    expect(call.to).toBe("lead@example.test");
    expect(call.html).toBe(REPORT.html);
  });

  it("uses EOD_SMTP_FROM over the login mailbox when a display alias is set", async () => {
    process.env.EOD_SMTP_FROM = "eod-reports@gmail.com";
    vi.resetModules();
    const { sendEodEmail } = await import("./actions");
    await sendEodEmail(REPORT);
    expect(sendMail.mock.calls[0][0].from).toContain("eod-reports@gmail.com");
  });

  it("attaches the case log only when one was given", async () => {
    vi.resetModules();
    const { sendEodEmail } = await import("./actions");

    await sendEodEmail({ ...REPORT, csv: "Date,Cases\n2026-09-08,12", csvFilename: "case_log_2026-09-08.csv" });
    expect(sendMail.mock.calls[0][0].attachments).toEqual([
      { filename: "case_log_2026-09-08.csv", content: "Date,Cases\n2026-09-08,12" },
    ]);

    sendMail.mockClear();
    await sendEodEmail(REPORT);
    expect(sendMail.mock.calls[0][0].attachments).toEqual([]);
  });

  it("turns a rejected send into a clean error instead of an unhandled exception", async () => {
    sendMail.mockRejectedValueOnce(new Error("535 authentication failed"));
    vi.resetModules();
    const { sendEodEmail } = await import("./actions");
    const result = await sendEodEmail(REPORT);
    expect(result.ok).toBe(false);
  });
});
