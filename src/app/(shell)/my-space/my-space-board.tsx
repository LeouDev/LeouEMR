"use client";

import { useEffect, useRef, useState } from "react";
import { PageBand } from "@/components/ui";
import { BOXES, boardProgress, type Board, type BoxKey } from "@/lib/my-space/board";
import type { SavedDay } from "@/lib/queries/my-space";
import { describeActionError } from "@/lib/ui/action-error";
import { addItem, deleteItem, editItem, saveDay, toggleItem } from "./actions";
import { BoxCard } from "./box-card";
import { HistoryPanel } from "./history-panel";
import { ProgressRail } from "./progress-rail";

const TOAST_MS = 3200;

type Toast = { text: string; tone: "ok" | "fail" };

/**
 * The board itself. Owns the items and the saved days as the page loaded
 * them and keeps them current as the person works: a tick or a delete
 * shows at once and is undone if the server refuses, an add or an edit
 * waits for the server's answer (the add needs the row's id), and "Save
 * day" moves the board into history and clears it. Errors surface as a
 * toast in the fail tone rather than a page reload.
 */
export function MySpaceBoard({
  initialBoard,
  initialDays,
  today,
  todayLabel,
  roleLabel,
}: {
  initialBoard: Board;
  initialDays: SavedDay[];
  /** Manila's today, YYYY-MM-DD. */
  today: string;
  todayLabel: string;
  roleLabel: string;
}) {
  const [board, setBoard] = useState<Board>(initialBoard);
  const [days, setDays] = useState<SavedDay[]>(initialDays);
  const [busyBox, setBusyBox] = useState<BoxKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  function show(text: string, tone: Toast["tone"] = "ok") {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, tone });
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }

  function update(box: BoxKey, change: (items: Board[BoxKey]) => Board[BoxKey]) {
    setBoard((current) => ({ ...current, [box]: change(current[box]) }));
  }

  async function add(box: BoxKey, text: string, note: string): Promise<boolean> {
    setBusyBox(box);
    try {
      const result = await addItem({ box, text, note });
      if (!result.ok) {
        show(result.error, "fail");
        return false;
      }
      update(box, (items) => [...items, result.item]);
      return true;
    } catch (cause) {
      show(describeActionError(cause), "fail");
      return false;
    } finally {
      setBusyBox(null);
    }
  }

  async function toggle(box: BoxKey, id: string) {
    update(box, (items) => items.map((item) => (item.id === id ? { ...item, complete: !item.complete } : item)));
    try {
      const result = await toggleItem({ id });
      if (!result.ok) {
        update(box, (items) => items.map((item) => (item.id === id ? { ...item, complete: !item.complete } : item)));
        show(result.error, "fail");
      }
    } catch (cause) {
      update(box, (items) => items.map((item) => (item.id === id ? { ...item, complete: !item.complete } : item)));
      show(describeActionError(cause), "fail");
    }
  }

  async function edit(box: BoxKey, id: string, text: string, note: string): Promise<boolean> {
    try {
      const result = await editItem({ id, text, note });
      if (!result.ok) {
        show(result.error, "fail");
        return false;
      }
      update(box, (items) => items.map((item) => (item.id === id ? { ...item, text, note } : item)));
      return true;
    } catch (cause) {
      show(describeActionError(cause), "fail");
      return false;
    }
  }

  async function remove(box: BoxKey, id: string) {
    const before = board[box];
    update(box, (items) => items.filter((item) => item.id !== id));
    try {
      const result = await deleteItem({ id });
      if (!result.ok) {
        update(box, () => before);
        show(result.error, "fail");
      }
    } catch (cause) {
      update(box, () => before);
      show(describeActionError(cause), "fail");
    }
  }

  async function save() {
    setSaving(true);
    try {
      const result = await saveDay();
      if (!result.ok) {
        show(result.error, "fail");
        return;
      }
      const saved: SavedDay = { day: result.day, boxes: result.boxes, savedAt: result.savedAt };
      setDays((current) => [saved, ...current.filter((d) => d.day !== saved.day)]);
      setBoard({ todos: [], decisions: [], ideas: [], letgo: [] });
      show("Day saved — board cleared for tomorrow");
    } catch (cause) {
      show(describeActionError(cause), "fail");
    } finally {
      setSaving(false);
    }
  }

  const progress = boardProgress(board);

  return (
    <>
      <PageBand
        title="My Space"
        subtitle={`${todayLabel} · ${roleLabel} workspace`}
        action={
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="border-2 border-cream bg-transparent px-4 py-2.5 text-[13px] font-bold text-cream transition hover:border-orange-brand hover:text-orange-brand"
            >
              History
            </button>
            <button type="button" onClick={() => void save()} disabled={saving} className="btn-primary px-[18px] py-2.5 text-[13px]">
              {saving ? "Saving…" : "Save day"}
            </button>
          </div>
        }
      />

      <main className="mx-auto flex max-w-7xl flex-wrap items-start gap-6 px-6 pt-7 pb-14">
        <div className="grid min-w-0 flex-[1_1_640px] grid-cols-1 gap-5 md:grid-cols-2">
          {BOXES.map((box) => (
            <BoxCard
              key={box}
              box={box}
              items={board[box]}
              busy={busyBox === box}
              onAdd={(text, note) => add(box, text, note)}
              onToggle={(id) => void toggle(box, id)}
              onEdit={(id, text, note) => edit(box, id, text, note)}
              onDelete={(id) => void remove(box, id)}
            />
          ))}
        </div>
        <div className="w-full md:sticky md:top-6 md:w-[220px] md:flex-none">
          <ProgressRail progress={progress} />
        </div>
      </main>

      {historyOpen && <HistoryPanel days={days} today={today} onClose={() => setHistoryOpen(false)} />}

      {toast && (
        <div
          role="status"
          className={`fixed bottom-7 left-1/2 z-50 -translate-x-1/2 animate-[fadeUp_.25s_ease] border-2 bg-navy-800 px-5 py-3 text-[13px] font-bold text-cream ${
            toast.tone === "fail" ? "border-fail" : "border-orange-brand"
          }`}
        >
          {toast.text}
        </div>
      )}
    </>
  );
}
