import Link from "next/link";
import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-xl border border-line bg-surface shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-6 py-4">
      <div>
        <h2 className="text-base font-semibold text-navy-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "pass" | "warn" | "fail";
  href?: string;
}) {
  const toneClass =
    tone === "pass"
      ? "text-pass"
      : tone === "warn"
        ? "text-warn"
        : tone === "fail"
          ? "text-fail"
          : "text-navy-900";

  const body = (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm transition hover:border-navy-100">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );

  return href ? <Link href={href}>{body}</Link> : body;
}

const STATUS_STYLES: Record<string, string> = {
  pass: "bg-pass-bg text-pass",
  warning: "bg-warn-bg text-warn",
  fail: "bg-fail-bg text-fail",
  OPEN: "bg-fail-bg text-fail",
  REOPENED: "bg-fail-bg text-fail",
  AWAITING_AGENT_ACKNOWLEDGEMENT: "bg-warn-bg text-warn",
  ACKNOWLEDGED: "bg-navy-100 text-navy-900",
  MONITORING: "bg-navy-100 text-navy-900",
  SUSTAINED: "bg-pass-bg text-pass",
  COMPLETED: "bg-pass-bg text-pass",
};

export const STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  AWAITING_AGENT_ACKNOWLEDGEMENT: "Awaiting acknowledgement",
  ACKNOWLEDGED: "Acknowledged",
  MONITORING: "Monitoring",
  SUSTAINED: "Sustained",
  COMPLETED: "Completed",
  REOPENED: "Reopened",
  pass: "Pass",
  warning: "Warning",
  fail: "Fail",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${
        STATUS_STYLES[status] ?? "bg-cream-dark text-muted"
      }`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="text-sm font-medium text-navy-900">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">{description}</p>
    </div>
  );
}

/** Formats a metric for display according to its KPI type. */
export function formatMetric(value: number | null, kpiCode: string): string {
  if (value === null || value === undefined) return "—";
  switch (kpiCode) {
    case "QUALITY":
    case "ATTENDANCE":
      return `${value.toFixed(1)}%`;
    case "AHT":
      return `${Math.round(value)}s`;
    case "CPH":
      return value.toFixed(2);
    case "NPS":
      return value.toFixed(0);
    default:
      return value.toFixed(2);
  }
}

export function formatWeek(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt(start)} – ${fmt(end)}`;
}
