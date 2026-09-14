"use client";

import { useNavigation } from "@/components/navigation-progress";

const SELECT = "border-2 border-ink bg-surface px-3 py-2 text-sm text-ink outline-none disabled:opacity-60";

/**
 * Who and when. Both live in the URL so a card can be linked, and the
 * server renders the chosen one rather than the client re-fetching.
 */
export function ScorecardPickers({
  people,
  employeeId,
  months,
  month,
}: {
  /** Empty for an agent, who only ever sees their own card. */
  people: Array<{ id: string; name: string; supervisorName: string | null }>;
  employeeId: string | null;
  months: Array<{ start: string; label: string }>;
  month: string;
}) {
  const { navigate, pending } = useNavigation();

  function go(next: { employee?: string; month?: string }) {
    const params = new URLSearchParams();
    const employee = next.employee ?? employeeId;
    if (people.length > 0 && employee) params.set("employee", employee);
    params.set("month", next.month ?? month);
    navigate(`/scorecard?${params.toString()}`);
  }

  return (
    <div className={`flex flex-wrap items-end gap-3 transition-opacity ${pending ? "opacity-60" : ""}`} aria-busy={pending}>
      {people.length > 0 && (
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold tracking-[0.08em] text-white/80 uppercase">Agent</span>
          <select
            value={employeeId ?? ""}
            onChange={(e) => go({ employee: e.target.value })}
            disabled={pending}
            className={`${SELECT} min-w-64`}
          >
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
                {person.supervisorName ? ` — ${person.supervisorName}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block">
        <span className="mb-1 block text-[11px] font-bold tracking-[0.08em] text-white/80 uppercase">Month</span>
        <select value={month} onChange={(e) => go({ month: e.target.value })} disabled={pending} className={SELECT}>
          {months.map((m) => (
            <option key={m.start} value={m.start}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
