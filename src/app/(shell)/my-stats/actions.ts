"use server";

import nodemailer from "nodemailer";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";

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
  html: z.string().min(1),
  text: z.string().min(1),
  csv: z.string().optional(),
  csvFilename: z.string().optional(),
});

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
    return { ok: true };
  } catch {
    return { ok: false, error: "The mail server rejected that send. Check the SMTP settings and try again." };
  }
}
