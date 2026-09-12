import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { confirmDestination } from "@/lib/auth/confirm-destination";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Completes email confirmation.
 *
 * Supabase's default "Confirm signup" template links here with a
 * `token_hash` and `type` rather than a PKCE `code` — deliberately: a code
 * exchange needs the verifier that was generated in the same browser the
 * signup happened in, so it breaks the moment someone opens the
 * confirmation email on their phone instead of the machine they signed up
 * on. Verifying the token hash server-side has no such requirement — any
 * device can complete it.
 *
 * Confirming an email is not the same as being let in: this app still
 * gates every account behind an administrator's approval on the Users
 * page (see drizzle/0001_auth_trigger_and_rls.sql — every signup lands as
 * role='agent', status='pending' regardless of this step), so a confirmed
 * account lands on /pending, not the dashboard. A password-reset link
 * ("Reset password" template, type=recovery) lands on /reset-password
 * instead, signed in only far enough to choose the new password.
 */
const VALID_TYPES = new Set(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  if (tokenHash && type && VALID_TYPES.has(type)) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({
      type: type as "signup" | "invite" | "magiclink" | "recovery" | "email_change" | "email",
      token_hash: tokenHash,
    });
    if (!error) redirect(confirmDestination(type));
  }

  redirect("/login?error=confirmation_failed");
}
