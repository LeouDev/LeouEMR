"use server";

import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { userActivityDays } from "@/lib/db/schema";
import { manilaDay } from "@/lib/utilization/report";

/**
 * Notes that the signed-in account opened the app today (Manila), for the
 * utilization report. Once a day per browser — the client keeps a marker —
 * and the row is upserted, so a second ping only moves `last_seen`. Fails
 * soft: a missing table (before its migration) or a busy pooler must never
 * reach the person as an error, since nothing they asked for depends on it.
 */
export async function recordActivity(): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false };
  try {
    await db
      .insert(userActivityDays)
      .values({ userId: user.id, day: manilaDay() })
      .onConflictDoUpdate({
        target: [userActivityDays.userId, userActivityDays.day],
        set: { lastSeen: new Date() },
      });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
