import { db } from "@/lib/db/client";
import { skillRampSchedules } from "@/lib/db/schema";

/** skillReferenceId -> (stage -> target), for rendering a board without a per-row query. */
export async function getRampSchedulesBySkill(): Promise<Map<string, Map<number, number>>> {
  const rows = await db.select().from(skillRampSchedules);
  const bySkill = new Map<string, Map<number, number>>();
  for (const row of rows) {
    const stages = bySkill.get(row.skillReferenceId) ?? new Map<number, number>();
    stages.set(row.stage, row.target);
    bySkill.set(row.skillReferenceId, stages);
  }
  return bySkill;
}
