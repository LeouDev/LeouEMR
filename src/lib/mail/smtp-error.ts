/**
 * What to tell the sender when the mail relay would not take the report.
 *
 * nodemailer marks every SMTP failure with a `code` naming the stage that
 * gave out and, where the server answered, its `response` line. Both are
 * safe to show — an SMTP response is the relay's own wording about the
 * sign-in, the addresses or the message, never a credential — and they
 * are the difference between "rejected, try again" (which sends an
 * administrator to three dashboards) and "535 Authentication failed"
 * (which sends them straight to the password).
 */

export interface SmtpTarget {
  host: string;
  port: number;
}

/** The longest response line worth echoing; relays can be verbose. */
const RESPONSE_MAX = 160;

function responseOf(cause: Record<string, unknown>): string {
  const response = typeof cause.response === "string" ? cause.response : "";
  return response.replace(/\s+/g, " ").trim().slice(0, RESPONSE_MAX);
}

export function describeSmtpFailure(cause: unknown, target: SmtpTarget): string {
  const error = (cause && typeof cause === "object" ? cause : {}) as Record<string, unknown>;
  const code = typeof error.code === "string" ? error.code : "";
  const response = responseOf(error);
  const where = `${target.host}:${target.port}`;
  const detail = response ? ` (${response})` : "";

  switch (code) {
    case "EDNS":
      return `Could not find the mail server ${target.host}. Check EOD_SMTP_HOST.`;
    case "ETIMEDOUT":
      return `The mail server at ${where} did not answer in time. Check EOD_SMTP_HOST and EOD_SMTP_PORT, then try again.`;
    case "ECONNECTION":
    case "ESOCKET":
    case "ETLS":
      return `Could not connect to the mail server at ${where}${detail}. Check EOD_SMTP_HOST and EOD_SMTP_PORT.`;
    case "EAUTH":
      return `The mail server refused the sign-in${detail}. Check EOD_SMTP_USER and EOD_SMTP_PASS.`;
    case "EENVELOPE":
      return `The mail server refused the sender or recipient address${detail}.`;
    case "EMESSAGE":
      return `The mail server refused the message${detail}.`;
    default: {
      const message = cause instanceof Error ? cause.message.replace(/\s+/g, " ").trim().slice(0, RESPONSE_MAX) : "";
      return `The mail server rejected that send${response ? detail : message ? ` (${message})` : ""}. Check the SMTP settings and try again.`;
    }
  }
}
