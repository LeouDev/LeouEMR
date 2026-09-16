import { describeSmtpFailure } from "./smtp-error";
import { mailFromAddress, mailTransport } from "./transport";
import { renderWelcomeEmail } from "./welcome-email";

export interface WelcomeRecipient {
  id: string;
  name: string;
  email: string;
  role: string;
}

/** Who a new joiner should write to when the app itself does not answer their question. */
const DEFAULT_SUPPORT_EMAIL = "leou.comendador@optum.com";

/**
 * The footer's postal address, which bulk mail is required to carry.
 *
 * A default rather than configuration-only: the address of the site the
 * team works from changes about as often as the company does, and leaving
 * it to an unset variable is how the footer ended up with no address at
 * all. MAIL_POSTAL_ADDRESS still overrides it, and a newline starts a new
 * line in the footer.
 */
const DEFAULT_POSTAL_ADDRESS = "Filinvest Cebu Cyberzone, Tower 4\nCebu IT Park, Apas, Cebu City, Cebu 6000";

/**
 * Where the email points people for help.
 *
 * The help link goes back to the app, which is the help centre until there
 * is a separate one; `HELP_URL` takes over when there is. Both values are
 * addresses that reach someone, which an empty href is not.
 */
function helpLinks(siteUrl: string) {
  return {
    helpUrl: process.env.HELP_URL?.trim() || siteUrl,
    supportEmail: process.env.SUPPORT_EMAIL?.trim() || DEFAULT_SUPPORT_EMAIL,
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
  const { helpUrl, supportEmail } = helpLinks(siteUrl);
  const postalAddress = process.env.MAIL_POSTAL_ADDRESS?.trim() || DEFAULT_POSTAL_ADDRESS;

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
