"use server";

import { eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { employeeProfiles, users } from "@/lib/db/schema";
import { signupConflict } from "@/lib/auth/signup-availability";

const schema = z.object({
  email: z.string().trim().email(),
  employeeEid: z.string().trim().regex(/^\d{9}$/),
  msid: z.string().trim().max(64),
});

export type SignupAvailability = { ok: true } | { ok: false; error: string };

/**
 * Whether a sign-up would be refused by the database, before Supabase is
 * asked to create the login.
 *
 * Deliberately reachable without a session — the person asking has no
 * account yet. It answers only "is this identifier already registered",
 * never who holds it, and only for identifiers the person has themselves
 * typed into the form. That is a small disclosure, accepted for an internal
 * tool where the alternative was a bare "Database error saving new user".
 * The database still enforces every rule this checks; this exists so the
 * refusal comes with a reason and a next step.
 */
export async function checkSignupAvailability(input: unknown): Promise<SignupAvailability> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: true }; // the form's own validation reports these

  const { email, employeeEid, msid } = parsed.data;

  const [accounts, profiles] = await Promise.all([
    db
      .select({ email: users.email, employeeEid: users.employeeEid })
      .from(users)
      .where(or(sql`lower(${users.email}) = ${email.toLowerCase()}`, eq(users.employeeEid, employeeEid))),
    db
      .select({ employeeEid: employeeProfiles.employeeEid, msid: employeeProfiles.msid })
      .from(employeeProfiles)
      .where(
        msid
          ? or(
              eq(employeeProfiles.employeeEid, employeeEid),
              sql`lower(${employeeProfiles.msid}) = ${msid.toLowerCase()}`,
            )
          : inArray(employeeProfiles.employeeEid, [employeeEid]),
      ),
  ]);

  const error = signupConflict(
    { email, employeeEid, msid },
    {
      emails: accounts.map((a) => a.email),
      employeeEids: [
        ...accounts.flatMap((a) => (a.employeeEid ? [a.employeeEid] : [])),
        ...profiles.map((p) => p.employeeEid),
      ],
      msids: profiles.flatMap((p) => (p.msid ? [p.msid] : [])),
    },
  );

  return error ? { ok: false, error } : { ok: true };
}
