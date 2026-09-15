"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { BOX_META, NOTE_MAX, TEXT_MAX, type BoardItem, type BoxKey } from "@/lib/my-space/board";

/**
 * One of the four boxes: its items, the row being edited, and the add
 * form at the foot. The drafts live here — what is being typed is nobody
 * else's business — while every committed change goes up to the board,
 * which owns the items and talks to the server.
 */
export function BoxCard({
  box,
  items,
  busy,
  onAdd,
  onToggle,
  onEdit,
  onDelete,
}: {
  box: BoxKey;
  items: BoardItem[];
  /** True while a save for this box is in flight; the add form waits. */
  busy: boolean;
  onAdd: (text: string, note: string) => Promise<boolean>;
  onToggle: (id: string) => void;
  onEdit: (id: string, text: string, note: string) => Promise<boolean>;
  onDelete: (id: string) => void;
}) {
  const meta = BOX_META[box];
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editNote, setEditNote] = useState("");

  const open = items.filter((item) => !item.complete).length;
  const countLine = meta.hasComplete ? `${open} open · ${items.length} total` : `${items.length} captured`;

  async function add() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    if (await onAdd(trimmed, note.trim())) {
      setText("");
      setNote("");
      setNoteOpen(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void add();
    }
  }

  function startEdit(item: BoardItem) {
    setEditingId(item.id);
    setEditText(item.text);
    setEditNote(item.note);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit() {
    if (!editingId) return;
    const trimmed = editText.trim();
    // An emptied row is a cancelled edit, not a deletion.
    if (!trimmed) return cancelEdit();
    if (await onEdit(editingId, trimmed, editNote.trim())) setEditingId(null);
  }

  return (
    <section className="flex flex-col border-2 border-ink bg-surface" aria-label={meta.title}>
      <div className="flex items-center gap-2.5 border-b-2 border-ink px-5 py-4">
        <BoxIcon box={box} />
        <div>
          <h2 className="text-[15px] font-bold text-ink">{meta.title}</h2>
          <p className="mt-0.5 text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">{countLine}</p>
        </div>
      </div>

      <ul className="flex-1 px-5 pt-0.5 pb-1.5">
        {items.map((item) =>
          editingId === item.id ? (
            <li key={item.id} className="flex flex-col gap-1.5 border-b-[1px] border-line py-2.5 last:border-0">
              <input
                type="text"
                value={editText}
                maxLength={TEXT_MAX}
                onChange={(event) => setEditText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void saveEdit();
                  if (event.key === "Escape") cancelEdit();
                }}
                aria-label="Edit text"
                autoFocus
                className="border-2 border-orange-brand px-2.5 py-1.5 text-[13px] text-ink"
              />
              <input
                type="text"
                value={editNote}
                maxLength={NOTE_MAX}
                onChange={(event) => setEditNote(event.target.value)}
                placeholder="Note"
                aria-label="Edit note"
                className="border-2 border-line px-2.5 py-1.5 text-xs text-muted"
              />
              <div className="flex gap-2">
                <button type="button" onClick={() => void saveEdit()} className="bg-orange-brand px-3.5 py-1.5 text-xs font-bold text-white hover:bg-orange-brand-dark">
                  Save
                </button>
                <button type="button" onClick={cancelEdit} className="border-2 border-ink bg-surface px-3.5 py-1.5 text-xs font-bold text-ink hover:bg-orange-brand-100">
                  Cancel
                </button>
              </div>
            </li>
          ) : (
            <li key={item.id} className="flex items-start gap-2.5 border-b-[1px] border-line py-2.5 last:border-0">
              {meta.hasComplete ? (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={item.complete}
                  aria-label={item.complete ? `Mark "${item.text}" not done` : `Mark "${item.text}" done`}
                  onClick={() => onToggle(item.id)}
                  className={`mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center border-2 border-ink ${item.complete ? "bg-orange-brand" : "bg-surface"}`}
                >
                  {item.complete && (
                    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.5} aria-hidden="true">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ) : (
                <span className="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center" aria-hidden="true">
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="var(--orange-500)">
                    <circle cx={12} cy={12} r={6} />
                  </svg>
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className={`text-[13px] break-words ${item.complete ? "text-ink-faint line-through" : "text-ink"}`}>{item.text}</p>
                {item.note && <p className="mt-0.5 text-[11px] break-words text-ink-faint">{item.note}</p>}
              </div>
              <div className="flex shrink-0 gap-0.5">
                <button type="button" onClick={() => startEdit(item)} aria-label={`Edit "${item.text}"`} className="p-0.5 text-[13px] text-muted hover:text-ink">
                  ✎
                </button>
                <button type="button" onClick={() => onDelete(item.id)} aria-label={`Delete "${item.text}"`} className="p-0.5 text-[13px] text-muted hover:text-fail">
                  ✕
                </button>
              </div>
            </li>
          ),
        )}
      </ul>

      <div className="border-t-2 border-ink px-5 py-3.5">
        <div className="flex gap-2">
          <input
            type="text"
            value={text}
            maxLength={TEXT_MAX}
            placeholder={meta.placeholder}
            aria-label={meta.placeholder}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            className="min-w-0 flex-1 border-2 border-ink bg-surface px-2.5 py-2 text-[13px] text-ink placeholder:text-ink-faint"
          />
          <button type="button" onClick={() => void add()} disabled={busy || !text.trim()} className="btn-secondary px-3.5 py-2 text-xs">
            {busy ? "Adding…" : "Add"}
          </button>
        </div>
        <button type="button" onClick={() => setNoteOpen((v) => !v)} className="pt-1.5 text-[11px] font-semibold text-muted underline hover:text-ink">
          {noteOpen ? "– note" : "+ note"}
        </button>
        {noteOpen && (
          <input
            type="text"
            value={note}
            maxLength={NOTE_MAX}
            placeholder="Optional note or tag"
            aria-label="Optional note or tag"
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={onKeyDown}
            className="mt-1.5 w-full border-2 border-line px-2.5 py-1.5 text-xs text-muted placeholder:text-ink-faint"
          />
        )}
      </div>
    </section>
  );
}

/** The four line icons, in the app's stroke style with the orange accent stroke. */
function BoxIcon({ box }: { box: BoxKey }): ReactNode {
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "var(--ink)", strokeWidth: 1.8, "aria-hidden": true } as const;
  switch (box) {
    case "todos":
      return (
        <svg {...common}>
          <path d="M4 6h6M4 12h6M4 18h6" />
          <path d="M13 6l2 2 3-4M13 13l2 2 3-4M13 20l2 2 3-4" stroke="var(--orange-500)" />
        </svg>
      );
    case "decisions":
      return (
        <svg {...common}>
          <path d="M12 3l9 9-9 9-9-9z" />
          <path d="M9 12l2 2 4-4" stroke="var(--orange-500)" />
        </svg>
      );
    case "ideas":
      return (
        <svg {...common}>
          <path d="M9 18h6M10 21h4" />
          <path d="M12 3a6 6 0 0 0-3 11c.6.4 1 1 1 1.7V17h4v-1.3c0-.7.4-1.3 1-1.7a6 6 0 0 0-3-11z" stroke="var(--orange-500)" />
        </svg>
      );
    case "letgo":
      return (
        <svg {...common}>
          <path d="M4 4h8v8H4z" />
          <path d="M14 10l6-6M14 4h6v6" stroke="var(--orange-500)" />
        </svg>
      );
  }
}
