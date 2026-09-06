import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { SignOutButton } from "./sign-out-button";

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  manager: "Manager",
  supervisor: "Supervisor / Team Leader",
  agent: "Agent",
};

export default async function DashboardPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">
              Performance Command Center
            </h1>
            <p className="text-sm text-slate-500">
              {user.name} · {ROLE_LABELS[user.role] ?? user.role}
            </p>
          </div>
          <SignOutButton />
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Authentication and roles are live</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
            You are signed in as <strong className="font-medium text-slate-900">{user.email}</strong> with
            the <strong className="font-medium text-slate-900">{user.role}</strong> role. Role-scoped
            dashboards, the weekly IDP view, and the action-item workspace are built on top of this
            foundation.
          </p>
        </div>
      </div>
    </main>
  );
}
