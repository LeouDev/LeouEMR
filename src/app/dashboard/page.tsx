import { redirect } from "next/navigation";
import { BrandMark, BrandWordmark } from "@/components/brand";
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
    <div className="min-h-screen bg-cream">
      <header className="border-b border-line bg-surface">
        <div className="h-1 bg-gradient-to-r from-navy-800 via-navy to-orange-brand" />
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3.5">
          <div className="flex items-center gap-3">
            <BrandMark className="h-9 w-9" />
            <div>
              <BrandWordmark className="text-lg" />
              <p className="text-xs tracking-[0.14em] text-muted uppercase">
                People <span className="text-orange-brand">|</span> Process{" "}
                <span className="text-orange-brand">|</span> Progress
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-navy-900">{user.name}</p>
              <p className="text-xs text-muted">{ROLE_LABELS[user.role] ?? user.role}</p>
            </div>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
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
