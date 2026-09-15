import { z } from "zod";
import type { UserRole } from "@/lib/auth/session";

/**
 * My Space: a leader's personal daily board — four boxes to capture and
 * work through the day, saved as a dated snapshot when the day is done.
 *
 * The pure parts: the board's shape, what counts as progress in each box,
 * the geometry of the progress rail, the history calendar, and who the
 * page is for. Everything here is deterministic on its inputs so it can be
 * tested without a database or a clock.
 */

export const BOXES = ["todos", "decisions", "ideas", "letgo"] as const;
export type BoxKey = (typeof BOXES)[number];

export interface BoardItem {
  id: string;
  text: string;
  note: string;
  /** Always false on an idea, which has nothing to complete. */
  complete: boolean;
}

export type Board = Record<BoxKey, BoardItem[]>;

export const BOX_META: Record<BoxKey, { title: string; placeholder: string; hasComplete: boolean }> = {
  todos: { title: "To Dos", placeholder: "Add a to-do…", hasComplete: true },
  decisions: { title: "Decisions", placeholder: "Add a decision…", hasComplete: true },
  ideas: { title: "Ideas", placeholder: "Jot down an idea…", hasComplete: false },
  letgo: { title: "Let Go", placeholder: "Something to let go of…", hasComplete: true },
};

/** An idea "progresses" simply by being captured: this many fill the planet. */
export const IDEAS_DAILY_GOAL = 5;

export const TEXT_MAX = 500;
export const NOTE_MAX = 300;

export function emptyBoard(): Board {
  return { todos: [], decisions: [], ideas: [], letgo: [] };
}

export function isBoardEmpty(board: Board): boolean {
  return BOXES.every((box) => board[box].length === 0);
}

/**
 * A box's progress, 0–100. Boxes with a completion state score the share
 * of items marked complete (0 when empty); ideas score how far the day's
 * count has come toward IDEAS_DAILY_GOAL.
 */
export function boxPercent(box: BoxKey, items: readonly BoardItem[]): number {
  if (!BOX_META[box].hasComplete) return Math.min(100, Math.round(items.length * (100 / IDEAS_DAILY_GOAL)));
  if (items.length === 0) return 0;
  return Math.round((items.filter((item) => item.complete).length / items.length) * 100);
}

export interface BoardProgress {
  byBox: Record<BoxKey, number>;
  /** The plain average of the four boxes. */
  overall: number;
}

export function boardProgress(board: Board): BoardProgress {
  const byBox = {
    todos: boxPercent("todos", board.todos),
    decisions: boxPercent("decisions", board.decisions),
    ideas: boxPercent("ideas", board.ideas),
    letgo: boxPercent("letgo", board.letgo),
  };
  const overall = Math.round((byBox.todos + byBox.decisions + byBox.ideas + byBox.letgo) / 4);
  return { byBox, overall };
}

// --- Progress rail geometry ------------------------------------------------

/** Planet radius 34: the orange fill is a square this wide clipped to it. */
export const PLANET_DIAMETER = 68;
/** Planet centres down the rail, in viewBox units, in box order. */
export const PLANET_Y: Record<BoxKey, number> = { todos: 90, decisions: 250, ideas: 410, letgo: 570 };

/** How far the fill square sits below its resting place: 0% hides it fully, 100% shows it all. */
export function planetOffset(percent: number): number {
  return Math.round((1 - percent / 100) * PLANET_DIAMETER);
}

/** The astronaut's position on the connecting line, from the first planet to the last. */
export function astronautY(overall: number): number {
  return Math.round(PLANET_Y.todos + (overall / 100) * (PLANET_Y.letgo - PLANET_Y.todos));
}

// --- History ---------------------------------------------------------------

export function daySummary(board: Board): string {
  const done = (items: readonly BoardItem[]) => items.filter((item) => item.complete).length;
  return `${done(board.todos)} done · ${done(board.decisions)} decided · ${board.ideas.length} ideas · ${done(board.letgo)} let go`;
}

const itemSchema = z.object({
  id: z.string(),
  text: z.string(),
  note: z.string().default(""),
  complete: z.boolean().default(false),
});

export const boardSchema = z.object({
  todos: z.array(itemSchema),
  decisions: z.array(itemSchema),
  ideas: z.array(itemSchema),
  letgo: z.array(itemSchema),
});

/** A saved snapshot back into a board; anything unreadable reads as an empty day rather than a crash. */
export function parseBoard(value: unknown): Board {
  const parsed = boardSchema.safeParse(value);
  return parsed.success ? parsed.data : emptyBoard();
}

/** "2026-09-01" → "2026-10-01"; any delta, across year ends. */
export function shiftMonth(monthStart: string, delta: number): string {
  const [y, m] = monthStart.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function monthStartOfDay(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export function monthLabel(monthStart: string): string {
  return new Date(`${monthStart}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** "Tuesday, September 15" — the band's date, without the year. */
export function dayHeadline(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

export function dayLongLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export interface CalendarCell {
  key: string;
  /** Empty for the leading blanks that pad the first week. */
  label: string;
  /** The day, when the cell is one; blanks have none. */
  day: string | null;
  saved: boolean;
  today: boolean;
  selected: boolean;
}

/**
 * A month's grid, Sunday-first, padded at the start to the weekday the
 * month begins on. Only days with a saved snapshot are worth clicking.
 */
export function calendarCells(
  monthStart: string,
  savedDays: ReadonlySet<string>,
  today: string,
  selected: string | null,
): CalendarCell[] {
  const [y, m] = monthStart.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: CalendarCell[] = [];
  for (let i = 0; i < firstWeekday; i++) {
    cells.push({ key: `blank-${i}`, label: "", day: null, saved: false, today: false, selected: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const day = `${monthStart.slice(0, 7)}-${String(d).padStart(2, "0")}`;
    cells.push({ key: day, label: String(d), day, saved: savedDays.has(day), today: day === today, selected: day === selected });
  }
  return cells;
}

// --- Who it is for ---------------------------------------------------------

/**
 * Team leaders, managers and the support roles (trainer, SME) — the people
 * who run a day rather than work a queue. An administrator has it too, as
 * they have every page. An agent's own day is on their action items.
 */
export function canUseMySpace(role: UserRole): boolean {
  return role !== "agent";
}

export function workspaceLabel(role: UserRole): string {
  switch (role) {
    case "supervisor":
      return "Team Leader";
    case "manager":
      return "Manager";
    case "trainer":
      return "Trainer";
    case "sme":
      return "SME";
    case "admin":
      return "Administrator";
    default:
      return "Agent";
  }
}
