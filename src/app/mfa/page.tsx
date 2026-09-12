import { redirect } from "next/navigation";
import { AuthLayout, PanelHeading } from "@/components/loading-scene";
import { SignOutButton } from "@/components/sign-out-button";
import { mfaRequiredFor } from "@/lib/auth/mfa";
import { getCurrentUser } from "@/lib/auth/session";
import { MfaForm } from "./mfa-form";

/**
 * The second step: set up an authenticator app, or enter its code.
 *
 * Required roles are sent here by the middleware and the shell layout
 * until their session carries the second step; anyone else can come here
 * from the header to add it. Everything that talks to Supabase happens in
 * the browser (enrol, challenge, verify), because the upgraded session has
 * to land in the browser's own cookies.
 */
export default async function MfaPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const required = mfaRequiredFor(user.role);
  return (
    <AuthLayout>
      <div className="fade-up flex w-full max-w-[440px] flex-col gap-[22px]">
        <PanelHeading
          kicker="Second step"
          title={required ? "Your role needs an authenticator." : "Add a second step."}
        />
        <div className="border-2 border-line px-4 py-3">
          <p className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">Signed in as</p>
          <p className="mt-1 text-base font-semibold text-ink">{user.email}</p>
        </div>
        <MfaForm required={required} next={user.status === "active" ? "/dashboard" : "/pending"} />
        <div className="border-t-2 border-line pt-[18px]">
          <SignOutButton tone="light" />
        </div>
      </div>
    </AuthLayout>
  );
}
