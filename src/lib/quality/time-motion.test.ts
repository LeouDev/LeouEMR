import { describe, expect, it } from "vitest";
import { QA_FORM_SEED } from "./forms";
import {
  TIME_MOTION_INCOMPLETE,
  draftRows,
  emptyDraft,
  filledCount,
  finalizeDraft,
  formatDelta,
  isComplete,
  parseSeconds,
  storedTimeMotionFromRow,
  timeMotionSpecOf,
  totals,
  validateStoredTimeMotion,
} from "./time-motion";

const phone = QA_FORM_SEED.find((f) => f.key === "phone")!.definition;
const spec = timeMotionSpecOf(phone)!;

describe("the Phone form", () => {
  it("is the only form with Time & Motion, in five segments totalling 480 seconds of baseline", () => {
    expect(spec.segments.map((s) => s.label)).toEqual([
      "Greeting / verification",
      "Account lookup",
      "Issue discussion",
      "Resolution / hold",
      "Wrap-up",
    ]);
    expect(totals(draftRows(spec, emptyDraft())).baseline).toBe(480);
    for (const key of ["avqa", "mpaqa", "faxqa"]) {
      expect(timeMotionSpecOf(QA_FORM_SEED.find((f) => f.key === key)!.definition)).toBeNull();
    }
  });
});

describe("the panel's draft", () => {
  it("takes the form's baseline until the evaluator overrides it, and reads the delta against whichever applies", () => {
    const draft = { ...emptyDraft(), baselines: { "Account lookup": "45" }, actuals: { "Account lookup": "50", "Wrap-up": "55" } };
    const rows = draftRows(spec, draft);
    expect(rows[1]).toEqual({ label: "Account lookup", baseline: 45, actual: 50, delta: 5 });
    expect(rows[4]).toEqual({ label: "Wrap-up", baseline: 60, actual: 55, delta: -5 });
    expect(rows[0]).toEqual({ label: "Greeting / verification", baseline: 30, actual: null, delta: null });
  });

  it("counts filled segments and is complete only when every one has an actual", () => {
    const draft = { ...emptyDraft(), actuals: { "Greeting / verification": "28", "Account lookup": "", "Issue discussion": "x" } };
    expect(filledCount(spec, draft)).toBe(1);
    expect(isComplete(spec, draft)).toBe(false);
    const full = { ...emptyDraft(), actuals: Object.fromEntries(spec.segments.map((s) => [s.label, "10"])) };
    expect(isComplete(spec, full)).toBe(true);
    expect(totals(draftRows(spec, full))).toEqual({ baseline: 480, actual: 50 });
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
    const draft = { callReference: " REC-88213 ", baselines: { "Wrap-up": "50" }, actuals: Object.fromEntries(spec.segments.map((s) => [s.label, "20"])) };
    const stored = finalizeDraft(spec, draft)!;
    expect(stored.callReference).toBe("REC-88213");
    expect(stored.segments[4]).toEqual({ label: "Wrap-up", baselineSeconds: 50, actualSeconds: 20 });
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
