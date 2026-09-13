"use server";

import { and, count, eq, gte, or, sql } from "drizzle-orm";
import nodemailer from "nodemailer";
import { z } from "zod";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { auditLog, employees, users } from "@/lib/db/schema";
import { EOD_DAILY_LIMIT, RECIPIENT_REFUSED, parseDomainList, recipientAllowed } from "@/lib/mail/recipients";
import { describeSmtpFailure, type SmtpTarget } from "@/lib/mail/smtp-error";

/**
 * Sends the end-of-day report by SMTP, on a server that holds the mailbox
 * credentials — a browser cannot open an authenticated SMTP connection
 * itself, which is the whole reason this used to be a `mailto:` link.
 *
 * The report's own content (the HTML, the plain-text fallback, the case log
 * CSV) is built entirely in the browser from data that never leaves it —
 * this action only relays whatever it is handed to the one place that can
 * actually deliver it, and never reads or stores any of it beyond the send.
 */

export type SendEodResult = { ok: true } | { ok: false; error: string };

const sendEodSchema = z.object({
  tlEmail: z.string().trim().email("Enter a valid email address for your team lead"),
  subject: z.string().trim().min(1).max(300),
  // Generous for a day's report, far too small for anything else.
  html: z.string().min(1).max(400_000),
  text: z.string().min(1).max(100_000),
  csv: z.string().max(1_000_000).optional(),
  csvFilename: z
    .string()
    .regex(/^[\w .()-]{1,120}\.csv$/i, "The attachment name must be a plain .csv file name")
    .optional(),
});

/**
 * The email addresses of the accounts leading the sender right now — their
 * supervisor's and their manager's — which are always acceptable recipients
 * whatever domain they use.
 */
async function leaderEmailsFor(user: CurrentUser): Promise<string[]> {
  if (!user.employeeEid) return [];
  const [row] = await db
    .select({ supervisorEid: employees.supervisorEid, managerName: employees.managerName })
    .from(employees)
    .where(eq(employees.eid, user.employeeEid))
    .limit(1);
  if (!row) return [];
  const leaders = [
    ...(row.supervisorEid ? [eq(users.employeeEid, row.supervisorEid)] : []),
    ...(row.managerName ? [and(eq(users.role, "manager"), eq(users.managerName, row.managerName))] : []),
  ];
  if (leaders.length === 0) return [];
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.status, "active"), or(...leaders)));
  return rows.map((r) => r.email);
}

async function sentToday(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.actorId, userId),
        eq(auditLog.action, "eod.sent"),
        gte(auditLog.createdAt, sql`date_trunc('day', now())`),
      ),
    );
  return row?.n ?? 0;
}

type Transport = {
  client: ReturnType<typeof nodemailer.createTransport>;
  target: SmtpTarget;
  /** The mailbox the relay authenticated, and the sender unless EOD_SMTP_FROM says otherwise. */
  login: string;
};

let cachedTransport: Transport | null = null;

/**
 * How long a send may spend on each stage before it is called off. The
 * library's own defaults (two minutes to connect, ten of silence before
 * giving up) are sized for a mail queue, not a request someone is
 * watching: a relay that stops answering used to hold the action until
 * the platform killed the function, which reached the sender as a
 * sending screen that never ended and no word on why.
 */
const SMTP_TIMEOUTS = {
  dnsTimeout: 10_000,
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 30_000,
} as const;

/** One transport per server instance, not one per send. */
function transport(): Transport | null {
  if (cachedTransport) return cachedTransport;

  const host = process.env.EOD_SMTP_HOST?.trim();
  const port = Number(process.env.EOD_SMTP_PORT?.trim());
  const user = process.env.EOD_SMTP_USER?.trim();
  const pass = process.env.EOD_SMTP_PASS?.trim();
  if (!host || !port || !user || !pass) return null;

  cachedTransport = {
    client: nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      // On the STARTTLS port the credentials go only over an upgraded
      // connection: a relay (or anything between) that drops the upgrade
      // gets a refusal, not the password in the clear.
      requireTLS: port !== 465,
      auth: { user, pass },
      ...SMTP_TIMEOUTS,
    }),
    target: { host, port },
    login: user,
  };
  return cachedTransport;
}

export async function sendEodEmail(input: unknown): Promise<SendEodResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };

  const parsed = sendEodSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That report could not be sent" };
  }

  const smtp = transport();
  if (!smtp) {
    return {
      ok: false,
      error: "Email sending isn't configured yet — an admin needs to set the EOD_SMTP_* environment variables.",
    };
  }

  // The mailbox this relays through must not become anyone's outbound
  // mail: the recipient has to be a leader over the sender or a company
  // address, and one account cannot send more than a handful a day.
  const allowed = recipientAllowed(parsed.data.tlEmail, {
    allowedDomains: parseDomainList(process.env.MAIL_ALLOWED_DOMAINS),
    leaderEmails: await leaderEmailsFor(user),
    senderEmail: user.email,
  });
  if (!allowed) return { ok: false, error: RECIPIENT_REFUSED };
  if ((await sentToday(user.id)) >= EOD_DAILY_LIMIT) {
    return { ok: false, error: `You have reached today's limit of ${EOD_DAILY_LIMIT} reports.` };
  }

  // Gmail (and most providers) reject or spam-flag a From address that
  // is not the authenticated mailbox, so the account stays fixed and the
  // agent's own name only decorates the display name. Reply-To is the
  // agent's real address so "Reply" in the team lead's inbox goes to them,
  // not to the shared mailbox this is relayed through.
  const mailbox = process.env.EOD_SMTP_FROM?.trim() || smtp.login;
  // The sender keeps a copy in their own inbox — nothing about the report
  // is stored here, so this is their only record of what went out. Their
  // account address is already a known one; it needs no recipient check.
  // Addressing the report to themselves would otherwise list them twice.
  const copyTo = parsed.data.tlEmail.toLowerCase() === user.email.toLowerCase() ? undefined : user.email;

  try {
    await smtp.client.sendMail({
      from: { name: `${user.name} (via OptumRx EMR)`, address: mailbox },
      replyTo: user.email,
      to: parsed.data.tlEmail,
      cc: copyTo,
      subject: parsed.data.subject,
      text: parsed.data.text,
      html: parsed.data.html,
      attachments: parsed.data.csv
        ? [{ filename: parsed.data.csvFilename || "case_log.csv", content: parsed.data.csv }]
        : [],
    });
  } catch (cause) {
    // The platform log is where an administrator looks when a sender
    // reports a failure; the sender gets the same reason, minus the stack.
    const error = (cause && typeof cause === "object" ? cause : {}) as Record<string, unknown>;
    console.error("[eod] send failed", {
      code: error.code,
      command: error.command,
      responseCode: error.responseCode,
      response: error.response,
      message: cause instanceof Error ? cause.message : String(cause),
    });
    return { ok: false, error: describeSmtpFailure(cause, smtp.target) };
  }

  // Every send on the record: who, to whom, and what — the daily limit
  // above is counted off these rows.
  try {
    await db.insert(auditLog).values({
      actorId: user.id,
      action: "eod.sent",
      entityType: "user",
      entityId: user.id,
      after: { to: parsed.data.tlEmail, cc: copyTo ?? null, subject: parsed.data.subject },
    });
  } catch {
    // The report has gone; a failed audit write must not report it as unsent.
  }
  return { ok: true };
}
