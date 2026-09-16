import { describeSmtpFailure } from "./smtp-error";
import { mailFromAddress, mailTransport } from "./transport";
import { renderWelcomeEmail } from "./welcome-email";

export interface WelcomeRecipient {
  id: string;
  name: string;
  email: string;
  role: string;
}

/**
 * Where the email points people for help.
 *
 * Neither value is invented. With no help centre configured the app itself
 * is the destination, and with no support mailbox the one that sent the
 * message stands in — both are addresses that actually reach someone,
 * which an empty href is not.
 */
function helpLinks(siteUrl: string, fallbackSupport: string) {
  return {
    helpUrl: process.env.HELP_URL?.trim() || siteUrl,
    supportEmail: process.env.SUPPORT_EMAIL?.trim() || fallbackSupport,
  };
}

/**
 * Sends the welcome email to everyone just approved.
 *
 * Best effort by design, and never throws: the approval is already
 * committed by the time this runs, and an account that is active but whose
 * welcome bounced is a far better outcome than an approval reported as
 * failed because a relay was down. Each failure is logged for an
 * administrator and reported in the count, not to the person approving.
 *
 * Returns one entry per recipient id, in the order given, so the caller can
 * record on each audit row whether that person was actually written to.
 */
export async function sendWelcomeEmails(
  recipients: WelcomeRecipient[],
  siteUrl: string | null,
): Promise<boolean[]> {
  if (recipients.length === 0) return [];

  const smtp = mailTransport();
  if (!smtp) {
    console.warn("[welcome] EOD_SMTP_* not configured; skipped", recipients.length, "email(s)");
    return recipients.map(() => false);
  }
  if (!siteUrl) {
    // Every useful thing in the message is the sign-in link. Sending one
    // that goes nowhere is worse than sending nothing.
    console.warn("[welcome] no app URL resolved; skipped", recipients.length, "email(s)");
    return recipients.map(() => false);
  }

  const from = mailFromAddress(smtp);
  const { helpUrl, supportEmail } = helpLinks(siteUrl, from);
  const postalAddress = process.env.MAIL_POSTAL_ADDRESS?.trim();

  const results: boolean[] = [];
  for (const person of recipients) {
    const { subject, html, text } = renderWelcomeEmail({
      name: person.name,
      email: person.email,
      role: person.role,
      siteUrl,
      helpUrl,
      supportEmail,
      postalAddress,
    });

    try {
      await smtp.client.sendMail({
        from: { name: "PA Command Center", address: from },
        to: person.email,
        replyTo: supportEmail,
        subject,
        text,
        html,
      });
      results.push(true);
    } catch (cause) {
      // Same shape the end-of-day send logs, for the same reader: the
      // platform log is where an administrator looks when someone says
      // they were approved and never heard about it.
      const error = (cause && typeof cause === "object" ? cause : {}) as Record<string, unknown>;
      console.error("[welcome] send failed", {
        to: person.email,
        code: error.code,
        response: error.response,
        reason: describeSmtpFailure(cause, smtp.target),
      });
      results.push(false);
    }
  }
  return results;
}
