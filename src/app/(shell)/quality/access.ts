import { redirect } from "next/navigation";
import { canAuditQuality } from "@/lib/auth/scope";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";

/** The signed-in leader every Quality Audit page renders for; anyone else is sent on. */
export async function requireQualityUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");
  if (!canAuditQuality(user)) redirect("/dashboard");
  return user;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
