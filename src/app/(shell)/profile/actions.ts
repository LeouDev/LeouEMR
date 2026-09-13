"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { auditLog, employeeProfiles, userAvatars } from "@/lib/db/schema";
import { AVATAR_NOT_AN_IMAGE, AVATAR_TOO_LARGE, MAX_AVATAR_BYTES, parseAvatarDataUrl } from "@/lib/profile/avatar";
import { NO_PROFILE, changedFields, formFromProfile, validateProfileForm, type ProfileForm } from "@/lib/profile/panel";

export type ProfileActionResult = { ok: true; profile: ProfileForm } | { ok: false; error: string };

// A blank column reads back as null; the page sends strings, but either is a blank.
const field = z
  .string()
  .max(500)
  .nullish()
  .transform((value) => value ?? "");
const schema = z.object({
  firstName: field,
  lastName: field,
  middleName: field,
  phoneNumber: field,
  addressLine1: field,
  addressLine2: field,
  cityProvince: field,
  country: field,
  zipcode: field,
  emergencyContactName: field,
  emergencyContactNumber: field,
  emergencyContactRelationship: field,
});

const orNull = (text: string) => (text === "" ? null : text);

/**
 * Saves the signed-in person's own personnel details. The row is found by
 * the account, never by an id from the page, so nobody edits anyone else's;
 * the employee ID, MSID and position on it are the roster's and are never
 * written here. Only what changed is logged.
 */
export async function updateMyProfile(input: unknown): Promise<ProfileActionResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That profile could not be saved." };
  const checked = validateProfileForm(parsed.data);
  if (!checked.ok) return checked;
  const after = checked.value;

  const [profile] = await db.select().from(employeeProfiles).where(eq(employeeProfiles.userId, user.id)).limit(1);
  if (!profile) return { ok: false, error: NO_PROFILE };

  const before = formFromProfile(profile);
  const changed = changedFields(before, after);
  if (changed.length === 0) return { ok: true, profile: before };

  await db.transaction(async (tx) => {
    await tx
      .update(employeeProfiles)
      .set({
        firstName: after.firstName,
        lastName: after.lastName,
        middleName: orNull(after.middleName),
        phoneNumber: orNull(after.phoneNumber),
        addressLine1: orNull(after.addressLine1),
        addressLine2: orNull(after.addressLine2),
        cityProvince: orNull(after.cityProvince),
        country: orNull(after.country),
        zipcode: orNull(after.zipcode),
        emergencyContactName: orNull(after.emergencyContactName),
        emergencyContactNumber: orNull(after.emergencyContactNumber),
        emergencyContactRelationship: orNull(after.emergencyContactRelationship),
        updatedAt: new Date(),
      })
      .where(eq(employeeProfiles.id, profile.id));
    await tx.insert(auditLog).values({
      actorId: user.id,
      action: "profile.updated",
      entityType: "employee_profile",
      entityId: profile.id,
      before: Object.fromEntries(changed.map((key) => [key, before[key]])),
      after: Object.fromEntries(changed.map((key) => [key, after[key]])),
    });
  });

  // The 201 file shows these details to the person's leaders.
  revalidatePath("/201-file");
  return { ok: true, profile: after };
}

export type AvatarActionResult = { ok: true; version: number | null } | { ok: false; error: string };

/**
 * Saves the signed-in person's profile picture, replacing any they had.
 * The browser has already cut it to a 256px square; the server checks
 * that what arrived is a small raster image before keeping it, and logs
 * the change without the bytes.
 */
export async function updateMyAvatar(input: unknown): Promise<AvatarActionResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };

  const image = input && typeof input === "object" ? (input as { image?: unknown }).image : undefined;
  if (typeof image === "string" && image.length > MAX_AVATAR_BYTES * 2) return { ok: false, error: AVATAR_TOO_LARGE };
  const parsed = parseAvatarDataUrl(image);
  if (!parsed) return { ok: false, error: AVATAR_NOT_AN_IMAGE };

  const updatedAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .insert(userAvatars)
      .values({ userId: user.id, contentType: parsed.contentType, image: parsed.base64, updatedAt })
      .onConflictDoUpdate({
        target: userAvatars.userId,
        set: { contentType: parsed.contentType, image: parsed.base64, updatedAt },
      });
    await tx.insert(auditLog).values({
      actorId: user.id,
      action: "avatar.updated",
      entityType: "user",
      entityId: user.id,
      before: null,
      after: { contentType: parsed.contentType, bytes: parsed.bytes },
    });
  });
  return { ok: true, version: updatedAt.getTime() };
}

/** Removes the signed-in person's profile picture; the initials show again. */
export async function removeMyAvatar(): Promise<AvatarActionResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };

  await db.transaction(async (tx) => {
    await tx.delete(userAvatars).where(eq(userAvatars.userId, user.id));
    await tx.insert(auditLog).values({
      actorId: user.id,
      action: "avatar.removed",
      entityType: "user",
      entityId: user.id,
      before: null,
      after: null,
    });
  });
  return { ok: true, version: null };
}
