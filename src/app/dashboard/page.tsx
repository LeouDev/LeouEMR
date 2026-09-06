import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { getCurrentUser } from "@/lib/auth/session";

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
    <div className="min-h-screen bg-cream">
      <AppHeader user={user} current="/dashboard" />

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
          <div className="border-b border-line px-6 py-4">
            <h1 className="text-base font-semibold text-navy-900">
              Welcome back, {user.name.split(" ")[0]}
            </h1>
            <p className="mt-0.5 text-sm text-muted">
              Signed in as {user.email} · {ROLE_LABELS[user.role] ?? user.role}
            </p>
          </div>
          <div className="px-6 py-5">
            <p className="max-w-2xl text-sm leading-relaxed text-navy-800">
              Authentication and role-based access are live. The weekly performance import, KPI
              evaluation, action-item workspace, and role-scoped dashboards build on this
              foundation.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Agents", hint: "Awaiting first import" },
            { label: "Active action items", hint: "Awaiting first import" },
            { label: "Awaiting acknowledgement", hint: "Awaiting first import" },
            { label: "Sustained improvements", hint: "Awaiting first import" },
          ].map((card) => (
            <div key={card.label} className="rounded-xl border border-line bg-surface p-4 shadow-sm">
              <p className="text-xs font-medium tracking-wide text-muted uppercase">{card.label}</p>
              <p className="mt-2 text-2xl font-semibold text-navy-900">—</p>
              <p className="mt-1 text-xs text-muted">{card.hint}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
