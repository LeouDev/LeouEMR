import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { SignOutButton } from "../dashboard/sign-out-button";

export default async function PendingPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");
  if (user.status === "active") redirect("/dashboard");

  const isDisabled = user.status === "disabled";

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">
          {isDisabled ? "Account disabled" : "Awaiting approval"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          {isDisabled
            ? "This account has been disabled. Contact your administrator if you believe this is a mistake."
            : "Your account was created and is waiting for an administrator to approve it and assign your role."}
        </p>
        <p className="mt-4 text-sm text-slate-500">{user.email}</p>
        <div className="mt-6 flex justify-center">
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
