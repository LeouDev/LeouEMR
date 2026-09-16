import nodemailer from "nodemailer";
import type { SmtpTarget } from "./smtp-error";

/**
 * The one authenticated SMTP connection this app sends anything through.
 *
 * Lived inside my-stats/actions.ts while the end-of-day report was the only
 * thing that sent mail. The welcome email needs the same relay, the same
 * timeouts and the same STARTTLS rule, and a "use server" module may export
 * only async functions — so a second caller could not have reached it
 * there without either duplicating the configuration or making the
 * transport an action of its own.
 */
export type Transport = {
  client: ReturnType<typeof nodemailer.createTransport>;
  target: SmtpTarget;
  /** The mailbox the relay authenticated, and the sender unless EOD_SMTP_FROM says otherwise. */
  login: string;
};

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

let cached: Transport | null = null;

/** One transport per server instance, not one per send. Null when unconfigured. */
export function mailTransport(): Transport | null {
  if (cached) return cached;

  const host = process.env.EOD_SMTP_HOST?.trim();
  const port = Number(process.env.EOD_SMTP_PORT?.trim());
  const user = process.env.EOD_SMTP_USER?.trim();
  const pass = process.env.EOD_SMTP_PASS?.trim();
  if (!host || !port || !user || !pass) return null;

  cached = {
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
  return cached;
}

/** The address every send is from — the authenticated mailbox unless an alias is configured. */
export function mailFromAddress(transport: Transport): string {
  return process.env.EOD_SMTP_FROM?.trim() || transport.login;
}
