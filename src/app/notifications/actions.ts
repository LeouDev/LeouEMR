"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { notifications } from "@/lib/db/schema";

/** Marks the caller's own notifications read. Never touches anyone else's. */
export async function markAllRead(): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false };

  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.recipientId, user.id), isNull(notifications.readAt)));

  revalidatePath("/notifications");
  return { ok: true };
}

export async function markRead(notificationId: string): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false };

  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      // Scoped by recipient so an id from another user's inbox does nothing.
      and(eq(notifications.id, notificationId), eq(notifications.recipientId, user.id)),
    );

  revalidatePath("/notifications");
  return { ok: true };
}
