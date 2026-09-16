import { WELCOME_APPROVED_HTML } from "./welcome-approved-template";

/** How each role is named to the person holding it — the sidebar's own wording. */
export const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  manager: "Manager",
  supervisor: "Team Leader",
  agent: "Agent",
  trainer: "Trainer",
  sme: "SME",
};

export interface WelcomeEmailValues {
  /** The account's full name, however it was entered at sign-up. */
  name: string;
  email: string;
  role: string;
  /** Base URL of the app; the button links to `${siteUrl}/login`. */
  siteUrl: string;
  helpUrl: string;
  supportEmail: string;
  /**
   * Printed above the legal line, one HTML line per line of text. The whole
   * line is dropped when this is empty.
   */
  postalAddress?: string;
}

/**
 * The greeting name.
 *
 * Accounts are named either "Juan Dela Cruz" or, following the workbook's
 * own convention, "Dela Cruz, Juan" — so the first word is the surname
 * exactly when a comma is present. Anything else (one word, an empty name)
 * is used whole rather than guessed at, since "Hi, !" is worse than a
 * formal greeting.
 */
export function firstNameOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "there";
  const comma = trimmed.indexOf(",");
  const head = comma >= 0 ? trimmed.slice(comma + 1).trim() : trimmed;
  return head.split(/\s+/)[0] || "there";
}

/**
 * Escapes a value for HTML.
 *
 * Every value here is either a person's own name and address or a
 * configured URL, and all of them land inside an attribute or a text node
 * in the template. A name carrying an ampersand is ordinary; one carrying
 * a quote would otherwise end the href it sits in.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Every marker the template carries, so a missed one is a test failure rather than "{{ .Role }}" in someone's inbox. */
export const WELCOME_PLACEHOLDERS = [
  "FirstName",
  "Role",
  "Email",
  "SiteURL",
  "HelpURL",
  "SupportEmail",
] as const;

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderWelcomeEmail(values: WelcomeEmailValues): RenderedEmail {
  const firstName = firstNameOf(values.name);
  const roleLabel = ROLE_LABELS[values.role] ?? values.role;
  // A trailing slash would make the button link to "//login".
  const siteUrl = values.siteUrl.replace(/\/+$/, "");

  const fill: Record<(typeof WELCOME_PLACEHOLDERS)[number], string> = {
    FirstName: firstName,
    Role: roleLabel,
    Email: values.email,
    SiteURL: siteUrl,
    HelpURL: values.helpUrl,
    SupportEmail: values.supportEmail,
  };

  let html = WELCOME_APPROVED_HTML;
  for (const key of WELCOME_PLACEHOLDERS) {
    html = html.replaceAll(`{{ .${key} }}`, escapeHtml(fill[key]));
  }

  // Required on a bulk-ish transactional send, but never invented here: with
  // no address configured the line goes rather than shipping a placeholder
  // to a real inbox.
  const address = values.postalAddress?.trim();
  html = html.replace(
    "[company address goes here]<br>\n",
    // Escaped before the line breaks go in, so the address is text and the
    // <br> between its lines is the only markup it can contribute.
    address ? `${escapeHtml(address).replace(/\r?\n/g, "<br>")}<br>\n` : "",
  );

  // Plain-text alternative, for clients that refuse HTML and for spam
  // scoring — a transactional mail with no text part scores worse.
  const text = [
    `You're in, ${firstName}!`,
    "",
    `An administrator has approved your PA Command Center account and assigned you the ${roleLabel} role.`,
    "",
    `Sign in: ${siteUrl}/login`,
    `Your sign-in address: ${values.email}`,
    "",
    `Need help? ${values.helpUrl} or ${values.supportEmail}`,
    "",
    "You're receiving this because an administrator approved access for this email address.",
  ].join("\n");

  return { subject: "Your PA Command Center account is approved", html, text };
}
