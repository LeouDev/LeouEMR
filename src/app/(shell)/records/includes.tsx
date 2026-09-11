/**
 * The "Includes" chips: one per artifact actually present on the item, so a
 * reader can see at a glance what a record holds before opening it. Shared
 * by the list and the detail header so the two can never disagree.
 */
export function includesOf(record: {
  hasRca: boolean;
  hasPlan: boolean;
  hasTimeMotion: boolean;
  acknowledged: boolean;
  status: string;
}): string[] {
  const chips: string[] = [];
  if (record.hasRca) chips.push("RCA");
  if (record.hasTimeMotion) chips.push("Time & Motion");
  if (record.hasPlan) chips.push("Action Plan");
  if (record.acknowledged) chips.push("Acknowledged");
  else if (record.status === "AWAITING_AGENT_ACKNOWLEDGEMENT") chips.push("Ack pending");
  return chips;
}

export function Chip({ children }: { children: string }) {
  return (
    <span className="inline-block bg-orange-brand-100 px-2 py-1 text-[11px] font-bold tracking-[0.08em] whitespace-nowrap text-ink uppercase">
      {children}
    </span>
  );
}
