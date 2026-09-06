import { redirect } from "next/navigation";
import { BrandLockup } from "@/components/brand";
import { getCurrentUser } from "@/lib/auth/session";
import { SignOutButton } from "../dashboard/sign-out-button";

export default async function PendingPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");
  if (user.status === "active") redirect("/dashboard");

  const isDisabled = user.status === "disabled";

  return (
    <main className="flex min-h-screen items-center justify-center bg-cream px-4 py-10">
      <div className="w-full max-w-md">
        <BrandLockup />

        <div className="mt-8 overflow-hidden rounded-xl border border-line bg-surface text-center shadow-sm">
          <div className="h-1 bg-gradient-to-r from-navy-800 via-navy to-orange-brand" />
          <div className="p-6">
            <h1 className="text-base font-semibold text-navy-900">
              {isDisabled ? "Account disabled" : "Awaiting approval"}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {isDisabled
                ? "This account has been disabled. Contact your administrator if you believe this is a mistake."
                : "Your account was created and is waiting for an administrator to approve it and assign your role."}
            </p>
            <p className="mt-4 text-sm font-medium text-navy-800">{user.email}</p>
            <div className="mt-6 flex justify-center">
              <SignOutButton />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
