"use server";

import { and, count, eq, gte, or, sql } from "drizzle-orm";
import nodemailer from "nodemailer";
import { z } from "zod";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { auditLog, employees, users } from "@/lib/db/schema";
import { EOD_DAILY_LIMIT, RECIPIENT_REFUSED, parseDomainList, recipientAllowed } from "@/lib/mail/recipients";

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

let cachedTransport: ReturnType<typeof nodemailer.createTransport> | null = null;

/** One transport per server instance, not one per send. */
function transport() {
  if (cachedTransport) return cachedTransport;

  const host = process.env.EOD_SMTP_HOST;
  const port = process.env.EOD_SMTP_PORT;
  const user = process.env.EOD_SMTP_USER;
  const pass = process.env.EOD_SMTP_PASS;
  if (!host || !port || !user || !pass) return null;

  cachedTransport = nodemailer.createTransport({
    host,
    port: Number(port),
    secure: Number(port) === 465,
    auth: { user, pass },
  });
  return cachedTransport;
}

export async function sendEodEmail(input: unknown): Promise<SendEodResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };

  const parsed = sendEodSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That report could not be sent" };
  }

  const client = transport();
  if (!client) {
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
  const mailbox = process.env.EOD_SMTP_FROM || process.env.EOD_SMTP_USER!;

  try {
    await client.sendMail({
      from: `"${user.name} (via OptumRx EMR)" <${mailbox}>`,
      replyTo: user.email,
      to: parsed.data.tlEmail,
      subject: parsed.data.subject,
      text: parsed.data.text,
      html: parsed.data.html,
      attachments: parsed.data.csv
        ? [{ filename: parsed.data.csvFilename || "case_log.csv", content: parsed.data.csv }]
        : [],
    });
  } catch {
    return { ok: false, error: "The mail server rejected that send. Check the SMTP settings and try again." };
  }

  // Every send on the record: who, to whom, and what — the daily limit
  // above is counted off these rows.
  try {
    await db.insert(auditLog).values({
      actorId: user.id,
      action: "eod.sent",
      entityType: "user",
      entityId: user.id,
      after: { to: parsed.data.tlEmail, subject: parsed.data.subject },
    });
  } catch {
    // The report has gone; a failed audit write must not report it as unsent.
  }
  return { ok: true };
}
