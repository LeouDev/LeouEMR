import { redirect } from "next/navigation";
import { AuthLayout, PanelHeading } from "@/components/loading-scene";
import { getCurrentUser } from "@/lib/auth/session";
import { SignOutButton } from "@/components/sign-out-button";

export default async function PendingPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");
  if (user.status === "active") redirect("/dashboard");

  const isDisabled = user.status === "disabled";

  return (
    <AuthLayout>
      <div className="fade-up flex w-full max-w-[420px] flex-col gap-[22px]">
        <PanelHeading
          kicker={isDisabled ? "Access revoked" : "Pending approval"}
          title={isDisabled ? "Account disabled." : "Almost there."}
        />

        <p className="text-base leading-relaxed text-muted">
          {isDisabled
            ? "This account has been disabled. Contact your administrator if you believe this is a mistake."
            : "Your account was created and is waiting for an administrator to approve it and assign your role."}
        </p>

        <div className="border-2 border-line px-4 py-3">
          <p className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">
            Signed in as
          </p>
          <p className="mt-1 text-base font-semibold text-ink">{user.email}</p>
        </div>

        <div className="border-t-2 border-line pt-[18px]">
          <SignOutButton tone="light" />
        </div>
      </div>
    </AuthLayout>
  );
}
