import { asc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { skillReferences } from "@/lib/db/schema";
import { QualityCalculator } from "./quality-calculator";
import { SkillWorkspace, type SkillRow } from "./skill-workspace";

export default async function SkillsPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");

  const rows = await db
    .select()
    .from(skillReferences)
    .orderBy(asc(skillReferences.sortOrder), asc(skillReferences.name));

  const skills: SkillRow[] = rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    target: row.target,
    lowerIsBetter: row.lowerIsBetter,
    r5: row.r5,
    r4: row.r4,
    r3: row.r3,
    r2: row.r2,
    r1: row.r1,
  }));

  return (
    <div className="min-h-screen bg-cream">
      <AppHeader user={user} current="/skills" />

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight text-navy-900">
            Skill reference &amp; rating calculator
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            Each skill&apos;s target and its R1&ndash;R5 rating curve. Performance at target rates
            exactly 3.000; below target the rating steps in whole numbers, above target it
            interpolates smoothly to 5.000.
          </p>
        </div>

        <SkillWorkspace skills={skills} canEditTargets={user.role === "admin"} />

        <div className="mt-6">
          <QualityCalculator
            skills={rows.map((row) => ({
              name: row.name,
              attributesPerAudit: row.attributesPerAudit,
            }))}
          />
        </div>
      </main>
    </div>
  );
}
