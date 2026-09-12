import { redirect } from "next/navigation";
import { AuthLayout, PanelHeading } from "@/components/loading-scene";
import { getCurrentUser } from "@/lib/auth/session";
import { ResetPasswordForm } from "./reset-password-form";

/**
 * Choose a new password.
 *
 * Reached from the link in a password-reset email (see /auth/confirm), which
 * signs the person in for exactly this, or by anyone already signed in who
 * wants to change theirs. The session is the proof of identity either way,
 * so there is nothing to type but the new password.
 */
export default async function ResetPasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <AuthLayout>
      <div className="fade-up flex w-full max-w-[420px] flex-col gap-[22px]">
        <PanelHeading kicker="Password" title="Choose a new password." />
        <div className="border-2 border-line px-4 py-3">
          <p className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">Signed in as</p>
          <p className="mt-1 text-base font-semibold text-ink">{user.email}</p>
        </div>
        <ResetPasswordForm next={user.status === "active" ? "/dashboard" : "/pending"} />
      </div>
    </AuthLayout>
  );
}
