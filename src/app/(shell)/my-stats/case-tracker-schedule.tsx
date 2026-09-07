"use client";

import { useState } from "react";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { ACTIVITY_SKILLS } from "@/lib/case-tracker/activities";
import {
  blockHours,
  parseScheduleLines,
  type ActivityBlock,
  type ScannedRow,
  type SkillTarget,
} from "@/lib/case-tracker/tracker";
import { CELL, ConfirmDelete, FIELD, HEAD, LABEL, NUM, fmt } from "./case-tracker-ui";
import { readScheduleImage } from "./case-tracker-ocr";

/**
 * The day's scheduled blocks: read off a screenshot, or typed in.
 *
 * Owns the whole scan-and-review cycle, because none of it outlives the
 * review — the parent only ever hears about blocks that were actually
 * agreed to and added.
 */
export function ScheduleCard({
  date,
  blocks,
  targets,
  onAdd,
  onRemove,
  onNotice,
}: {
  date: string;
  /** Blocks already recorded for this date. */
  blocks: ActivityBlock[];
  targets: Map<string, SkillTarget>;
  onAdd: (rows: ActivityBlock[]) => void;
  onRemove: (id: string) => void;
  onNotice: (message: string | null) => void;
}) {
  const [scanning, setScanning] = useState(false);
  const [review, setReview] = useState<ScannedRow[] | null>(null);
  const [counted, setCounted] = useState<Record<number, boolean>>({});
  const [manual, setManual] = useState<{ skillCode: string; start: string; end: string }>({
    skillCode: ACTIVITY_SKILLS[0].skillCode,
    start: "",
    end: "",
  });

  const id = () =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${performance.now()}`;

  const dayBlocks = blocks.filter((b) => b.date === date);

  const scan = async (file: File | null | undefined) => {
    if (!file) return;
    setScanning(true);
    onNotice(null);
    try {
      const lines = await readScheduleImage(file);
      const rows = parseScheduleLines(lines);
      if (rows.length === 0) {
        onNotice("No schedule rows could be read from that image. Try a tighter crop, or add the block by hand.");
        setReview(null);
      } else {
        setReview(rows);
        // Only a certain match starts ticked. An approximate one has to be
        // agreed to, because the activity codes sit one edit apart from
        // queues that are not on the list at all.
        setCounted(Object.fromEntries(rows.map((row, i) => [i, row.match?.exact === true])));
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "The screenshot could not be read.");
    } finally {
      setScanning(false);
    }
  };

  const commitReview = () => {
    if (!review) return;
    const rows: ActivityBlock[] = [];
    for (const [index, row] of review.entries()) {
      if (!counted[index] || row.hours === null) continue;
      rows.push({
        id: id(),
        date,
        activity: row.raw,
        start: row.start,
        end: row.end,
        skillCode: row.match?.skillCode ?? null,
      });
    }
    onAdd(rows);
    setReview(null);
    setCounted({});
  };

  return (
    <Card>
      <CardHeader
        title={`Scheduled blocks — ${date}`}
        subtitle="Paste a schedule screenshot, or add a block by hand"
      />

      <div className="border-b-2 border-ink px-6 py-5">
        <label
          className="flex cursor-pointer flex-wrap items-center justify-between gap-3 border-2 border-dashed border-line px-4 py-4 text-sm text-muted transition hover:border-orange-brand"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void scan(e.dataTransfer.files?.[0]);
          }}
        >
          <span>
            Drop a schedule screenshot here, or choose a file. It is read in this browser and never uploaded.
          </span>
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              void scan(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <span className="btn-secondary px-4 py-2 text-sm">
            {scanning ? "Reading…" : "Choose image"}
          </span>
        </label>
      </div>

      {review && (
        <div className="border-b-2 border-ink">
          <p className="px-6 pt-4 text-sm text-muted">
            Check each row against the screenshot before adding it. Rows read as an exact activity
            code are ticked; anything approximate is not, because two of these queues differ by a
            single character.
          </p>
          <div className="overflow-x-auto px-6 py-3">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr className="border-b-2 border-ink bg-cream">
                  <th className={HEAD}>Count</th>
                  <th className={HEAD}>Read as</th>
                  <th className={HEAD}>Matched</th>
                  <th className={HEAD}>Start</th>
                  <th className={HEAD}>End</th>
                  <th className={HEAD}>Hours</th>
                </tr>
              </thead>
              <tbody>
                {review.map((row, index) => (
                  <tr key={index} className="border-b-2 border-line last:border-0">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Count ${row.raw}`}
                        checked={counted[index] ?? false}
                        disabled={row.hours === null}
                        onChange={(e) =>
                          setCounted((prev) => ({ ...prev, [index]: e.target.checked }))
                        }
                        className="h-4 w-4 accent-orange-brand"
                      />
                    </td>
                    <td className={`${CELL} font-mono text-xs`}>
                      {row.raw}
                      {row.confidence !== null && row.confidence < 75 && (
                        <span className="ml-2 text-warn">low confidence</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-sm">
                      {row.match ? (
                        <>
                          <span className="text-ink">{row.match.activity}</span>
                          {!row.match.exact && (
                            <span className="ml-2 bg-warn-bg px-2 py-0.5 text-[10px] font-bold tracking-[0.08em] text-warn uppercase">
                              approximate
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-muted">not a tracked activity</span>
                      )}
                    </td>
                    <td className={`${NUM} text-muted`}>{row.start}</td>
                    <td className={`${NUM} text-muted`}>{row.end}</td>
                    <td className={`${NUM} ${row.hours === null ? "text-fail" : "text-ink"}`}>
                      {row.hours === null ? "unreadable" : fmt(row.hours)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2 px-6 pb-4">
            <button type="button" onClick={commitReview} className="btn-secondary px-4 py-2 text-sm">
              Add ticked rows
            </button>
            <button
              type="button"
              onClick={() => {
                setReview(null);
                setCounted({});
              }}
              className="px-4 py-2 text-sm font-semibold text-muted transition hover:text-fail"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 border-b-2 border-ink px-6 py-4">
        <div>
          <label className={LABEL} htmlFor="ct-manual-skill">
            Activity
          </label>
          <select
            id="ct-manual-skill"
            value={manual.skillCode}
            onChange={(e) => setManual((prev) => ({ ...prev, skillCode: e.target.value }))}
            className={`${FIELD} mt-1.5`}
          >
            {ACTIVITY_SKILLS.map((entry) => (
              <option key={entry.activity} value={entry.skillCode}>
                {entry.activity}
              </option>
            ))}
            <option value="">Something else (not counted)</option>
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor="ct-manual-start">
            Start
          </label>
          <input
            id="ct-manual-start"
            type="time"
            value={manual.start}
            onChange={(e) => setManual((prev) => ({ ...prev, start: e.target.value }))}
            className={`${FIELD} mt-1.5 font-mono`}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="ct-manual-end">
            End
          </label>
          <input
            id="ct-manual-end"
            type="time"
            value={manual.end}
            onChange={(e) => setManual((prev) => ({ ...prev, end: e.target.value }))}
            className={`${FIELD} mt-1.5 font-mono`}
          />
        </div>
        <button
          type="button"
          onClick={() => {
            const hours = blockHours(manual.start, manual.end);
            if (hours === null) {
              onNotice("That start and end time do not make a workable block.");
              return;
            }
            const label =
              ACTIVITY_SKILLS.find((a) => a.skillCode === manual.skillCode)?.activity ?? "Other";
            onAdd([
              {
                id: id(),
                date,
                activity: label,
                start: manual.start,
                end: manual.end,
                skillCode: manual.skillCode || null,
              },
            ]);
            setManual((prev) => ({ ...prev, start: "", end: "" }));
          }}
          className="btn-secondary px-4 py-2 text-sm"
        >
          Add block
        </button>
      </div>

      {dayBlocks.length === 0 ? (
        <EmptyState
          title="No blocks for this date"
          description="Paste your schedule screenshot, or add the block you are working now."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-b-2 border-ink bg-cream">
                <th className={`${HEAD} px-6`}>Activity</th>
                <th className={HEAD}>Skill</th>
                <th className={HEAD}>Start</th>
                <th className={HEAD}>End</th>
                <th className={HEAD}>Hours</th>
                <th className={`${HEAD} px-6`} />
              </tr>
            </thead>
            <tbody>
              {dayBlocks.map((b) => {
                const hours = blockHours(b.start, b.end);
                const skill = b.skillCode ? targets.get(b.skillCode) : undefined;
                return (
                  <tr key={b.id} className="border-b-2 border-line last:border-0">
                    <td className={`${CELL} px-6 ${skill ? "" : "text-muted"}`}>{b.activity}</td>
                    <td className={`${CELL} text-muted`}>{skill?.name ?? "not counted"}</td>
                    <td className={`${NUM} text-muted`}>{b.start}</td>
                    <td className={`${NUM} text-muted`}>{b.end}</td>
                    <td className={`${NUM} ${hours === null ? "text-fail" : "text-ink"}`}>
                      {hours === null ? "unreadable" : fmt(hours)}
                    </td>
                    <td className="px-6 py-2 text-right">
                      <ConfirmDelete
                        label={`Remove ${b.activity}`}
                        onConfirm={() =>
                          onRemove(b.id)
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
