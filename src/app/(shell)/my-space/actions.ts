"use server";

import { and, asc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { mySpaceDays, mySpaceItems, mySpaceNotes } from "@/lib/db/schema";
import {
  BOXES,
  BOX_META,
  NOTE_MAX,
  PAD_MAX,
  TEXT_MAX,
  canUseMySpace,
  emptyBoard,
  isBoardEmpty,
  type Board,
  type BoardItem,
} from "@/lib/my-space/board";
import { todayInManila } from "@/lib/scorecard/review";

/**
 * The board's writes. Every one is scoped to the caller's own account —
 * an item id from someone else's board matches nothing here — and every
 * one is refused to an agent, whose day lives on their action items.
 * Nothing here is audited: the board is private notes, not a record.
 */

type Failure = { ok: false; error: string };
export type ItemResult = { ok: true; item: BoardItem } | Failure;
export type ToggleResult = { ok: true; complete: boolean } | Failure;
export type ActionResult = { ok: true } | Failure;
export type SaveDayResult = { ok: true; day: string; boxes: Board; savedAt: string } | Failure;

// Module-private: a "use server" file may export only async functions.
const NOT_FOR_AGENTS = "My Space is for team leaders, managers and the support roles";

const boxSchema = z.enum(BOXES);
const textSchema = z.string().trim().min(1, "Write something first").max(TEXT_MAX, `Keep it under ${TEXT_MAX} characters`);
const noteSchema = z.string().trim().max(NOTE_MAX, `Keep the note under ${NOTE_MAX} characters`).default("");
const addSchema = z.object({ box: boxSchema, text: textSchema, note: noteSchema });
const editSchema = z.object({ id: z.string().uuid(), text: textSchema, note: noteSchema });
const idSchema = z.object({ id: z.string().uuid() });
// Not trimmed, unlike an item's text: the indentation and blank lines in a
// notepad are the writer's, and stripping them would rewrite what they typed
// under them. Only the ceiling is enforced.
const padSchema = z.object({
  text: z.string().max(PAD_MAX, `Keep the notepad under ${PAD_MAX} characters`),
});

async function owner(): Promise<CurrentUser | Failure> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };
  if (!canUseMySpace(user.role)) return { ok: false, error: NOT_FOR_AGENTS };
  return user;
}

const isFailure = (value: CurrentUser | Failure): value is Failure => "ok" in value;

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input";
}

export async function addItem(input: unknown): Promise<ItemResult> {
  const user = await owner();
  if (isFailure(user)) return user;
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  const [row] = await db
    .insert(mySpaceItems)
    .values({ userId: user.id, box: parsed.data.box, text: parsed.data.text, note: parsed.data.note })
    .returning({ id: mySpaceItems.id, text: mySpaceItems.text, note: mySpaceItems.note, complete: mySpaceItems.complete });

  revalidatePath("/my-space");
  return { ok: true, item: row };
}

export async function toggleItem(input: unknown): Promise<ToggleResult> {
  const user = await owner();
  if (isFailure(user)) return user;
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  const [item] = await db
    .select({ box: mySpaceItems.box, complete: mySpaceItems.complete })
    .from(mySpaceItems)
    .where(and(eq(mySpaceItems.id, parsed.data.id), eq(mySpaceItems.userId, user.id)))
    .limit(1);
  if (!item) return { ok: false, error: "That item is no longer on your board" };
  if (!BOX_META[item.box].hasComplete) return { ok: false, error: "An idea has nothing to complete" };

  const complete = !item.complete;
  await db
    .update(mySpaceItems)
    .set({ complete, updatedAt: new Date() })
    .where(and(eq(mySpaceItems.id, parsed.data.id), eq(mySpaceItems.userId, user.id)));

  revalidatePath("/my-space");
  return { ok: true, complete };
}

export async function editItem(input: unknown): Promise<ActionResult> {
  const user = await owner();
  if (isFailure(user)) return user;
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  const updated = await db
    .update(mySpaceItems)
    .set({ text: parsed.data.text, note: parsed.data.note, updatedAt: new Date() })
    .where(and(eq(mySpaceItems.id, parsed.data.id), eq(mySpaceItems.userId, user.id)))
    .returning({ id: mySpaceItems.id });
  if (updated.length === 0) return { ok: false, error: "That item is no longer on your board" };

  revalidatePath("/my-space");
  return { ok: true };
}

export async function deleteItem(input: unknown): Promise<ActionResult> {
  const user = await owner();
  if (isFailure(user)) return user;
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  await db.delete(mySpaceItems).where(and(eq(mySpaceItems.id, parsed.data.id), eq(mySpaceItems.userId, user.id)));

  revalidatePath("/my-space");
  return { ok: true };
}

/**
 * Archives the board as today's snapshot (Manila's today, like the rest of
 * the app's calendar) and clears it for tomorrow. Saving twice on one day
 * replaces the earlier snapshot. Only the items that went into the
 * snapshot are removed, so one added while the save was in flight is not
 * lost with it.
 */
export async function saveDay(): Promise<SaveDayResult> {
  const user = await owner();
  if (isFailure(user)) return user;

  const items = await db
    .select({
      id: mySpaceItems.id,
      box: mySpaceItems.box,
      text: mySpaceItems.text,
      note: mySpaceItems.note,
      complete: mySpaceItems.complete,
    })
    .from(mySpaceItems)
    .where(eq(mySpaceItems.userId, user.id))
    .orderBy(asc(mySpaceItems.createdAt), asc(mySpaceItems.id));

  const boxes = emptyBoard();
  for (const row of items) boxes[row.box].push({ id: row.id, text: row.text, note: row.note, complete: row.complete });
  if (isBoardEmpty(boxes)) return { ok: false, error: "Nothing on the board to save yet" };

  const day = todayInManila();
  const savedAt = new Date();
  await db
    .insert(mySpaceDays)
    .values({ userId: user.id, day, boxes, savedAt })
    .onConflictDoUpdate({ target: [mySpaceDays.userId, mySpaceDays.day], set: { boxes, savedAt } });
  await db.delete(mySpaceItems).where(
    and(
      eq(mySpaceItems.userId, user.id),
      inArray(
        mySpaceItems.id,
        items.map((row) => row.id),
      ),
    ),
  );

  revalidatePath("/my-space");
  return { ok: true, day, boxes, savedAt: savedAt.toISOString() };
}

/**
 * The notepad, written whole on each save.
 *
 * An upsert onto the one row the unique constraint on user_id allows, so a
 * person's pad cannot fork in two if a slow save and a fast one cross.
 *
 * Deliberately no revalidatePath. The pad autosaves while its owner types,
 * and revalidating would re-render the entire board — every box, the rail
 * and the history — on each of those saves, for a value the client already
 * holds. The four boxes revalidate because their writes change what the
 * server computes from; this one changes nothing but itself.
 */
export async function saveNote(input: unknown): Promise<ActionResult> {
  const user = await owner();
  if (isFailure(user)) return user;

  const parsed = padSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  const now = new Date();
  await db
    .insert(mySpaceNotes)
    .values({ userId: user.id, text: parsed.data.text, updatedAt: now })
    .onConflictDoUpdate({
      target: mySpaceNotes.userId,
      set: { text: parsed.data.text, updatedAt: now },
    });

  return { ok: true };
}
