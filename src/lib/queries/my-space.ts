import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { mySpaceDays, mySpaceItems } from "@/lib/db/schema";
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
}

/**
 * Someone's board and their saved days — theirs alone: both reads are
 * scoped by the account id, so a leader never sees another leader's
 * board, however wide their reporting scope. Items come back in the order
 * they were added, which is the order the box shows them.
 */
export async function getMySpace(userId: string): Promise<MySpace> {
  const [items, days] = await Promise.all([
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
  ]);

  const board = emptyBoard();
  for (const row of items) {
    board[row.box].push({ id: row.id, text: row.text, note: row.note, complete: row.complete });
  }

  return {
    board,
    days: days.map((row) => ({ day: row.day, boxes: parseBoard(row.boxes), savedAt: row.savedAt.toISOString() })),
  };
}
