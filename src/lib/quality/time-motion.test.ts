import { describe, expect, it } from "vitest";
import { DEFAULT_SEGMENTS } from "@/lib/time-motion/engine";
import { QA_FORM_SEED } from "./forms";
import {
  TIME_MOTION_INCOMPLETE,
  applyTimer,
  draftRows,
  emptyDraft,
  filledCount,
  finalizeDraft,
  formatDelta,
  isComplete,
  parseSeconds,
  storedTimeMotionFromRow,
  timeMotionSpecOf,
  timerSegmentsOf,
  totals,
  validateStoredTimeMotion,
} from "./time-motion";

const phone = QA_FORM_SEED.find((f) => f.key === "phone")!.definition;
const spec = timeMotionSpecOf(phone)!;

describe("the Phone form", () => {
  it("is the only form with Time & Motion, timing the same five segments as the action item's call study", () => {
    expect(spec.segments).toEqual(DEFAULT_SEGMENTS.map((s) => ({ label: s.label, baseline: s.defaultBaselineSeconds })));
    expect(spec.segments.map((s) => s.label)).toEqual([
      "Opening & Verification",
      "Identify the Concern",
      "Investigation",
      "Delivery of Findings",
      "Closing",
    ]);
    expect(totals(draftRows(spec, emptyDraft())).baseline).toBe(300);
    for (const key of ["avqa", "mpaqa", "faxqa"]) {
      expect(timeMotionSpecOf(QA_FORM_SEED.find((f) => f.key === key)!.definition)).toBeNull();
    }
  });
});

describe("the panel's draft", () => {
  it("takes the form's baseline until the evaluator overrides it, and reads the delta against whichever applies", () => {
    const draft = { ...emptyDraft(), baselines: { "Identify the Concern": "40" }, actuals: { "Identify the Concern": "50", Closing: "25" } };
    const rows = draftRows(spec, draft);
    expect(rows[1]).toEqual({ label: "Identify the Concern", baseline: 40, actual: 50, delta: 10 });
    expect(rows[4]).toEqual({ label: "Closing", baseline: 30, actual: 25, delta: -5 });
    expect(rows[0]).toEqual({ label: "Opening & Verification", baseline: 30, actual: null, delta: null });
  });

  it("counts filled segments and is complete only when every one has an actual", () => {
    const draft = { ...emptyDraft(), actuals: { "Opening & Verification": "28", "Identify the Concern": "", Investigation: "x" } };
    expect(filledCount(spec, draft)).toBe(1);
    expect(isComplete(spec, draft)).toBe(false);
    const full = { ...emptyDraft(), actuals: Object.fromEntries(spec.segments.map((s) => [s.label, "10"])) };
    expect(isComplete(spec, full)).toBe(true);
    expect(totals(draftRows(spec, full))).toEqual({ baseline: 300, actual: 50 });
  });

  it("hands the stopwatch the form's segments under any baseline already overridden, and takes its results back as whole seconds", () => {
    const overridden = { ...emptyDraft(), baselines: { Investigation: "150" } };
    expect(timerSegmentsOf(spec, overridden)[2]).toEqual({ code: "Investigation", label: "Investigation", baselineSeconds: 150 });

    const midCall = timerSegmentsOf(spec, overridden).map((s, i) => ({
      ...s,
      actualSeconds: i === 0 ? 31.6 : i === 1 ? 44.2 : null,
    }));
    const draft = applyTimer({ ...overridden, callReference: "CR-1" }, midCall);
    expect(draft.callReference).toBe("CR-1");
    expect(draft.baselines).toEqual({
      "Opening & Verification": "30",
      "Identify the Concern": "45",
      Investigation: "150",
      "Delivery of Findings": "75",
      Closing: "30",
    });
    expect(draft.actuals).toEqual({ "Opening & Verification": "32", "Identify the Concern": "44" });
    expect(filledCount(spec, draft)).toBe(2);

    const reset = applyTimer(draft, midCall.map((s) => ({ ...s, actualSeconds: null })));
    expect(reset.actuals).toEqual({});
    expect(reset.baselines.Investigation).toBe("150");
  });

  it("parses seconds strictly: blank, negative and absurd values are not numbers", () => {
    expect(parseSeconds("30")).toBe(30);
    expect(parseSeconds(" 12.6 ")).toBe(13);
    expect(parseSeconds("")).toBeNull();
    expect(parseSeconds("-1")).toBeNull();
    expect(parseSeconds("999999")).toBeNull();
    expect(parseSeconds(undefined)).toBeNull();
  });

  it("words a delta with its sign", () => {
    expect(formatDelta(12)).toBe("+12s");
    expect(formatDelta(-5)).toBe("−5s");
    expect(formatDelta(0)).toBe("0s");
    expect(formatDelta(null)).toBe("");
  });

  it("finalises to the stored shape only once complete", () => {
    const draft = { callReference: " REC-88213 ", baselines: { Closing: "50" }, actuals: Object.fromEntries(spec.segments.map((s) => [s.label, "20"])) };
    const stored = finalizeDraft(spec, draft)!;
    expect(stored.callReference).toBe("REC-88213");
    expect(stored.segments[4]).toEqual({ label: "Closing", baselineSeconds: 50, actualSeconds: 20 });
    expect(finalizeDraft(spec, emptyDraft())).toBeNull();
  });
});

describe("validateStoredTimeMotion", () => {
  const good = {
    callReference: "REC-1",
    segments: spec.segments.map((s) => ({ label: s.label, baselineSeconds: s.baseline, actualSeconds: 10 })),
  };

  it("accepts every segment once with whole non-negative seconds", () => {
    expect(validateStoredTimeMotion(spec, good)).toEqual({
      callReference: "REC-1",
      segments: spec.segments.map((s) => ({ label: s.label, baselineSeconds: s.baseline, actualSeconds: 10 })),
    });
  });

  it("refuses a missing segment, a bad number or the wrong shape, with the page's own sentence", () => {
    expect(validateStoredTimeMotion(spec, { ...good, segments: good.segments.slice(1) })).toEqual({ error: TIME_MOTION_INCOMPLETE });
    expect(validateStoredTimeMotion(spec, { ...good, segments: [{ ...good.segments[0], actualSeconds: -3 }, ...good.segments.slice(1)] })).toEqual({
      error: TIME_MOTION_INCOMPLETE,
    });
    expect(validateStoredTimeMotion(spec, undefined)).toEqual({ error: TIME_MOTION_INCOMPLETE });
    expect(validateStoredTimeMotion(spec, { segments: "no" })).toEqual({ error: TIME_MOTION_INCOMPLETE });
  });

  it("ignores segments the form does not have and caps the call reference", () => {
    const result = validateStoredTimeMotion(spec, {
      callReference: "x".repeat(200),
      segments: [...good.segments, { label: "Extra", baselineSeconds: 1, actualSeconds: 1 }],
    });
    expect("segments" in result && result.segments).toHaveLength(5);
    expect("callReference" in result && result.callReference.length).toBe(120);
  });
});

describe("storedTimeMotionFromRow", () => {
  it("narrows a stored value and drops malformed segments", () => {
    expect(storedTimeMotionFromRow({ callReference: "R", segments: [{ label: "a", baselineSeconds: 1, actualSeconds: 2 }, { label: 3 }] })).toEqual({
      callReference: "R",
      segments: [{ label: "a", baselineSeconds: 1, actualSeconds: 2 }],
    });
    expect(storedTimeMotionFromRow(null)).toBeNull();
    expect(storedTimeMotionFromRow({})).toBeNull();
  });
});
