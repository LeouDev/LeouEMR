"use server";

import { isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { canSwitchView, encodeViewAs, VIEW_AS_COOKIE, VIEW_AS_MAX_AGE } from "@/lib/auth/view-as";
import { db } from "@/lib/db/client";
import { employees } from "@/lib/db/schema";

const schema = z.object({
  /** A manager name from the imported data to view as; null returns to the administrator's own view. */
  managerName: z.string().trim().min(1).max(200).nullable(),
});

export type ViewAsResult = { ok: true } | { ok: false; error: string };

/**
 * Switches an administrator's whole session to a manager's view, or back.
 * Only a real administrator may set it, and only to a manager name the
 * data actually carries — the cookie is otherwise ignored (see
 * src/lib/auth/view-as.ts), so this is a convenience, not a permission.
 */
export async function setViewAs(input: unknown): Promise<ViewAsResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };
  if (!canSwitchView(user)) return { ok: false, error: "Only an administrator can switch views" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid view" };

  const cookieStore = await cookies();
  if (parsed.data.managerName === null) {
    cookieStore.delete(VIEW_AS_COOKIE);
  } else {
    const known = await db
      .selectDistinct({ name: employees.managerName })
      .from(employees)
      .where(isNotNull(employees.managerName));
    if (!known.some((r) => r.name === parsed.data.managerName)) {
      return { ok: false, error: "That manager is not in the imported data" };
    }
    cookieStore.set(VIEW_AS_COOKIE, encodeViewAs({ role: "manager", managerName: parsed.data.managerName }), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: VIEW_AS_MAX_AGE,
    });
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
