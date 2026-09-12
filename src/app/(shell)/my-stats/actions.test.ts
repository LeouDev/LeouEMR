import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/auth/session";
import { EOD_DAILY_LIMIT, RECIPIENT_REFUSED } from "@/lib/mail/recipients";

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
const createTransport = vi.hoisted(() => vi.fn(() => ({ sendMail })));
vi.mock("nodemailer", () => ({
  default: { createTransport },
}));

// The action reads three things before a send — the sender's employee row,
// the accounts leading them, and how many reports they sent today — and
// writes one audit row after. Each awaited query takes the next result set.
const queue = vi.hoisted(() => ({ results: [] as unknown[][], inserted: [] as unknown[] }));
vi.mock("@/lib/db/client", () => {
  const builder: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
            Promise.resolve(queue.results.shift() ?? []).then(resolve, reject);
        }
        if (prop === "values") {
          return (rows: unknown) => {
            queue.inserted.push(rows);
            return builder;
          };
        }
        return () => builder;
      },
    },
  );
  return { db: builder };
});

/** No employee row, so no leaders; nothing sent today. */
function plainSender(sentToday = 0) {
  queue.results = [[], [{ n: sentToday }]];
  queue.inserted = [];
}

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

const SMTP_KEYS = [
  "EOD_SMTP_HOST",
  "EOD_SMTP_PORT",
  "EOD_SMTP_USER",
  "EOD_SMTP_PASS",
  "EOD_SMTP_FROM",
  "MAIL_ALLOWED_DOMAINS",
] as const;

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
    plainSender();
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

  it("copies the sender on every report, except when they are the team lead themselves", async () => {
    vi.resetModules();
    const { sendEodEmail } = await import("./actions");

    await sendEodEmail(REPORT);
    expect(sendMail.mock.calls[0][0].cc).toBe("kristian.reyes@example.test");
    expect(queue.inserted[0]).toMatchObject({ after: { cc: "kristian.reyes@example.test" } });

    sendMail.mockClear();
    queue.results = [[], [{ n: 0 }]];
    queue.inserted = [];
    await sendEodEmail({ ...REPORT, tlEmail: "Kristian.Reyes@example.test" });
    expect(sendMail.mock.calls[0][0].to).toBe("Kristian.Reyes@example.test");
    expect(sendMail.mock.calls[0][0].cc).toBeUndefined();
    expect(queue.inserted[0]).toMatchObject({ after: { cc: null } });
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
    expect(queue.inserted).toEqual([]);
  });

  it("tells the sender what the relay said and where it was reached, and logs the same", async () => {
    const refusal = Object.assign(new Error("Invalid login"), {
      code: "EAUTH",
      response: "535 5.7.8 Authentication failed: bad username",
      responseCode: 535,
      command: "AUTH PLAIN",
    });
    sendMail.mockRejectedValueOnce(refusal);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const { sendEodEmail } = await import("./actions");
    const result = await sendEodEmail(REPORT);
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toContain("535 5.7.8 Authentication failed");
    expect((result as { error: string }).error).toContain("EOD_SMTP_PASS");
    expect(logged).toHaveBeenCalledWith(
      "[eod] send failed",
      expect.objectContaining({ code: "EAUTH", responseCode: 535, command: "AUTH PLAIN" }),
    );
    logged.mockRestore();
  });

  it("gives every stage of the relay conversation a deadline and never sends credentials in the clear", async () => {
    process.env.EOD_SMTP_HOST = " smtp-relay.brevo.com ";
    process.env.EOD_SMTP_PORT = "587";
    createTransport.mockClear();
    vi.resetModules();
    const { sendEodEmail } = await import("./actions");
    await sendEodEmail(REPORT);
    expect(createTransport).toHaveBeenCalledTimes(1);
    const options = (createTransport.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(options).toMatchObject({ host: "smtp-relay.brevo.com", port: 587, secure: false, requireTLS: true });
    for (const key of ["dnsTimeout", "connectionTimeout", "greetingTimeout", "socketTimeout"]) {
      expect(options[key]).toBeTypeOf("number");
      expect(options[key] as number).toBeLessThanOrEqual(30_000);
    }
  });

  it("uses implicit TLS on port 465 rather than STARTTLS", async () => {
    createTransport.mockClear();
    vi.resetModules();
    const { sendEodEmail } = await import("./actions");
    await sendEodEmail(REPORT);
    const options = (createTransport.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(options).toMatchObject({ port: 465, secure: true, requireTLS: false });
  });

  it("records every send on the audit trail", async () => {
    vi.resetModules();
    const { sendEodEmail } = await import("./actions");
    await sendEodEmail(REPORT);
    expect(queue.inserted).toHaveLength(1);
    expect(queue.inserted[0]).toMatchObject({
      actorId: "agent-1",
      action: "eod.sent",
      after: { to: "lead@example.test", subject: REPORT.subject },
    });
  });
});

describe("sendEodEmail — who it may go to", () => {
  beforeEach(() => {
    currentUser.value = USER;
    process.env.EOD_SMTP_HOST = "smtp.gmail.com";
    process.env.EOD_SMTP_PORT = "465";
    process.env.EOD_SMTP_USER = "sender@gmail.com";
    process.env.EOD_SMTP_PASS = "an-app-password";
    sendMail.mockClear();
    sendMail.mockResolvedValue({});
  });

  it("refuses an address off the sender's own domain when no company domains are configured", async () => {
    plainSender();
    vi.resetModules();
    const { sendEodEmail } = await import("./actions");
    expect(await sendEodEmail({ ...REPORT, tlEmail: "anyone@gmail.com" })).toEqual({
      ok: false,
      error: RECIPIENT_REFUSED,
    });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("allows only the configured company domains once they are set", async () => {
    process.env.MAIL_ALLOWED_DOMAINS = "optum.com";
    plainSender();
    vi.resetModules();
    const { sendEodEmail } = await import("./actions");
    // The sender's own domain no longer counts on its own.
    expect((await sendEodEmail(REPORT)).ok).toBe(false);
    plainSender();
    expect(await sendEodEmail({ ...REPORT, tlEmail: "lead@optum.com" })).toEqual({ ok: true });
  });

  it("always allows the sender's own leader, whatever their address", async () => {
    process.env.MAIL_ALLOWED_DOMAINS = "optum.com";
    // Employee row names a supervisor; that supervisor's account is on Gmail.
    queue.results = [
      [{ supervisorEid: "001305110", managerName: "Comendador, Leou" }],
      [{ email: "lead@gmail.com" }],
      [{ n: 0 }],
    ];
    queue.inserted = [];
    vi.resetModules();
    const { sendEodEmail } = await import("./actions");
    expect(await sendEodEmail({ ...REPORT, tlEmail: "Lead@Gmail.com" })).toEqual({ ok: true });
  });

  it("stops at the daily limit", async () => {
    vi.resetModules();
    const { sendEodEmail } = await import("./actions");
    plainSender(EOD_DAILY_LIMIT);
    const result = await sendEodEmail(REPORT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(String(EOD_DAILY_LIMIT));
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("refuses an attachment name that is not a plain csv file name", async () => {
    plainSender();
    vi.resetModules();
    const { sendEodEmail } = await import("./actions");
    const result = await sendEodEmail({ ...REPORT, csv: "a,b", csvFilename: "../../etc/passwd" });
    expect(result.ok).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });
});
