import Link from "next/link";
import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden border-2 border-ink bg-surface ${className}`}>
      {children}
    </div>
  );
}

/**
 * The navy band that titles a page, sitting directly under the header.
 *
 * Carries the page heading itself rather than only being decoration, so the
 * title reads as part of the brand band instead of repeating below it.
 */
export function PageBand({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-b-2 border-ink bg-navy-800">
      <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-3 px-6 py-7">
        <div>
          <h1 className="text-[34px] leading-[1.05] font-extrabold tracking-[-0.01em] text-cream">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2.5 text-[11px] font-bold tracking-[0.16em] text-orange-brand uppercase">
              {subtitle}
            </p>
          )}
        </div>
        {action}
      </div>
    </div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-ink px-6 py-4">
      <div>
        <h2 className="text-base font-bold text-ink">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
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
          : "text-ink";

  const body = (
    <div className="h-full border-2 border-ink bg-surface p-4 transition hover:bg-orange-brand-100">
      <p className="text-[11px] font-bold tracking-[0.16em] text-orange-brand uppercase">{label}</p>
      <p className={`mt-3 text-[32px] leading-none font-extrabold tracking-[-0.01em] tabular-nums ${toneClass}`}>
        {value}
      </p>
      {hint && <p className="mt-2 text-xs text-muted">{hint}</p>}
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
  ACKNOWLEDGED: "bg-orange-brand-100 text-ink",
  MONITORING: "bg-orange-brand-100 text-ink",
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
      className={`inline-flex items-center px-2 py-1 text-[11px] font-bold tracking-[0.08em] whitespace-nowrap uppercase ${
        STATUS_STYLES[status] ?? "bg-line text-muted"
      }`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

const EWS_RISK_STYLES: Record<string, string> = {
  GREEN: "bg-pass-bg text-pass",
  YELLOW: "bg-warn-bg text-warn",
  RED: "bg-fail-bg text-fail",
  BLACK: "bg-navy-900 text-white",
};

const EWS_RISK_LABELS: Record<string, string> = {
  GREEN: "Stable",
  YELLOW: "Watch",
  RED: "At risk",
  BLACK: "Critical",
};

/**
 * Shared with the per-employee EWS panel, so a risk level reads identically
 * whether it is being recorded on one person's page or scanned across a
 * whole board.
 */
export function EwsRiskBadge({ riskLevel, score }: { riskLevel: string; score?: number }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold ${
        EWS_RISK_STYLES[riskLevel] ?? "bg-line text-muted"
      }`}
    >
      {EWS_RISK_LABELS[riskLevel] ?? riskLevel}
      {score !== undefined && <span className="font-mono opacity-70">{score}</span>}
    </span>
  );
}

/**
 * Text colour for a measured value, from its evaluated status.
 *
 * The engine reports status in upper case ("PASS"/"WARNING"/"FAIL") while the
 * database enum is lower case; both are accepted here so a caller comparing
 * the wrong one cannot silently render everything as neutral, which is
 * exactly what happened before this existed.
 */
export function metricTone(status: string | null | undefined): string {
  switch (status?.toUpperCase()) {
    case "FAIL":
      return "text-fail";
    case "WARNING":
      return "text-warn";
    case "PASS":
      return "text-pass";
    default:
      return "text-muted";
  }
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="text-sm font-bold text-ink">{title}</p>
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
