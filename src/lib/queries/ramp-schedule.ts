import { CACHE_TAG, cachedRead } from "@/lib/cache";
import { db } from "@/lib/db/client";
import { skillRampSchedules } from "@/lib/db/schema";

/** The ramp schedules are seeded reference data; cached until a ramp-related write evicts them. */
const readRampSchedules = cachedRead("ramp-schedules", [CACHE_TAG.ramp], () =>
  db
    .select({
      skillReferenceId: skillRampSchedules.skillReferenceId,
      stage: skillRampSchedules.stage,
      target: skillRampSchedules.target,
    })
    .from(skillRampSchedules),
);

/** skillReferenceId -> (stage -> target), for rendering a board without a per-row query. */
export async function getRampSchedulesBySkill(): Promise<Map<string, Map<number, number>>> {
  const rows = await readRampSchedules();
  const bySkill = new Map<string, Map<number, number>>();
  for (const row of rows) {
    const stages = bySkill.get(row.skillReferenceId) ?? new Map<number, number>();
    stages.set(row.stage, row.target);
    bySkill.set(row.skillReferenceId, stages);
  }
  return bySkill;
}
