/**
 * Where a verified email link takes the person.
 *
 * A confirmed sign-up still waits for an administrator (every account is
 * created pending), so it lands on /pending. A password-reset link has
 * signed them in solely to choose a new password, so it lands on the page
 * that does that and nothing else.
 */
export function confirmDestination(type: string): string {
  return type === "recovery" ? "/reset-password" : "/pending";
}
