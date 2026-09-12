/**
 * Who the end-of-day report may be sent to.
 *
 * The report goes out through a mailbox the app holds credentials for, so
 * the address an agent types is the only thing between that mailbox and
 * being a relay for anyone with an account. A recipient is allowed when it
 * is one of the sender's own leaders' accounts, or an address on a company
 * domain (`MAIL_ALLOWED_DOMAINS`); with no domains configured, the sender's
 * own email domain stands in, since accounts are made with company email.
 */

/** The part after the last "@", lower-cased; null when there is no usable one. */
export function emailDomain(address: string): string | null {
  const at = address.lastIndexOf("@");
  if (at < 1 || at === address.length - 1) return null;
  return address.slice(at + 1).trim().toLowerCase();
}

/** "optum.com, @uhg.com" → ["optum.com", "uhg.com"]. */
export function parseDomainList(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

export function recipientAllowed(
  to: string,
  context: {
    allowedDomains: readonly string[];
    leaderEmails: readonly string[];
    senderEmail: string;
  },
): boolean {
  const target = to.trim().toLowerCase();
  if (context.leaderEmails.some((e) => e.trim().toLowerCase() === target)) return true;
  const domain = emailDomain(target);
  if (domain === null) return false;
  if (context.allowedDomains.length > 0) return context.allowedDomains.includes(domain);
  const own = emailDomain(context.senderEmail);
  return own !== null && own === domain;
}

/** Reports one account may send in a calendar day (UTC). Nobody files more than a few. */
export const EOD_DAILY_LIMIT = 10;

export const RECIPIENT_REFUSED =
  "Reports can only be sent to your team leader or manager, or to a company email address.";
