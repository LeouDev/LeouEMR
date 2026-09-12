"use server";

import { redirect } from "next/navigation";
import { confirmDestination, isConfirmType } from "@/lib/auth/confirm-destination";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Spends the one-time token from an email link and signs the person in.
 *
 * Verifying the token hash server-side rather than exchanging a PKCE code
 * means the link works from any device, not only the browser the request
 * was made in. Where it lands depends on the link: a confirmed sign-up
 * still waits for an administrator (every account is created pending), a
 * password reset goes to the page that sets the new password.
 */
export async function confirmLink(formData: FormData): Promise<void> {
  const tokenHash = String(formData.get("token_hash") ?? "");
  const type = String(formData.get("type") ?? "");
  if (!tokenHash || !isConfirmType(type)) redirect("/login?error=confirmation_failed");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) redirect("/login?error=confirmation_failed");
  redirect(confirmDestination(type));
}
