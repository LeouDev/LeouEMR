import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { mySpaceDays, mySpaceItems, mySpaceNotes } from "@/lib/db/schema";
import { emptyBoard, parseBoard, type Board } from "@/lib/my-space/board";

export interface SavedDay {
  /** The Manila calendar day the board was saved as. */
  day: string;
  boxes: Board;
  /** ISO timestamp of the save. */
  savedAt: string;
}

export interface MySpace {
  board: Board;
  /** Newest first. */
  days: SavedDay[];
  /**
   * The notepad's text, or null when it could not be read at all — which is
   * the state between this code deploying and migration 0059 being applied.
   * The page draws a pad that says so rather than failing outright.
   */
  note: string | null;
}

/**
 * Someone's board and their saved days — theirs alone: both reads are
 * scoped by the account id, so a leader never sees another leader's
 * board, however wide their reporting scope. Items come back in the order
 * they were added, which is the order the box shows them.
 */
export async function getMySpace(userId: string): Promise<MySpace> {
  const [items, days, note] = await Promise.all([
    db
      .select({
        id: mySpaceItems.id,
        box: mySpaceItems.box,
        text: mySpaceItems.text,
        note: mySpaceItems.note,
        complete: mySpaceItems.complete,
      })
      .from(mySpaceItems)
      .where(eq(mySpaceItems.userId, userId))
      .orderBy(asc(mySpaceItems.createdAt), asc(mySpaceItems.id)),
    db
      .select({ day: mySpaceDays.day, boxes: mySpaceDays.boxes, savedAt: mySpaceDays.savedAt })
      .from(mySpaceDays)
      .where(eq(mySpaceDays.userId, userId))
      .orderBy(desc(mySpaceDays.day)),
    // The pad's table arrives with migration 0059, and the code deploys
    // before the migration is applied. A table that is not there yet must
    // cost the reader their notepad and nothing else: the four boxes, the
    // progress rail and every saved day are still perfectly readable, so
    // this answers null instead of taking the page down with it.
    db
      .select({ text: mySpaceNotes.text })
      .from(mySpaceNotes)
      .where(eq(mySpaceNotes.userId, userId))
      .limit(1)
      .then((rows) => rows[0]?.text ?? "")
      .catch(() => null),
  ]);

  const board = emptyBoard();
  for (const row of items) {
    board[row.box].push({ id: row.id, text: row.text, note: row.note, complete: row.complete });
  }

  return {
    board,
    days: days.map((row) => ({ day: row.day, boxes: parseBoard(row.boxes), savedAt: row.savedAt.toISOString() })),
    note,
  };
}
