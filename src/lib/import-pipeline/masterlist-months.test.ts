import { describe, expect, it } from "vitest";
import { masterlistMonthFromBatch } from "./masterlist-months";

describe("masterlistMonthFromBatch", () => {
  it("reads the month a newer upload stored outright", () => {
    expect(
      masterlistMonthFromBatch({
        id: "b1",
        validationSummary: { kind: "masterlist", month: "September 2026", monthStart: "2026-09-01", monthEnd: "2026-09-30" },
      }),
    ).toEqual({ batchId: "b1", start: "2026-09-01", end: "2026-09-30" });
  });

  it("parses the label the first uploads recorded", () => {
    expect(masterlistMonthFromBatch({ id: "b2", validationSummary: { kind: "masterlist", month: "September 2026" } })).toEqual({
      batchId: "b2",
      start: "2026-09-01",
      end: "2026-09-30",
    });
    expect(masterlistMonthFromBatch({ id: "b3", validationSummary: { kind: "masterlist", month: "February 2028" } })).toEqual({
      batchId: "b3",
      start: "2028-02-01",
      end: "2028-02-29",
    });
  });

  it("ignores weekly workbook batches and unreadable summaries", () => {
    expect(masterlistMonthFromBatch({ id: "w1", validationSummary: { errors: 0, warnings: 2 } })).toBeNull();
    expect(masterlistMonthFromBatch({ id: "w2", validationSummary: null })).toBeNull();
    expect(masterlistMonthFromBatch({ id: "w3", validationSummary: { kind: "masterlist", month: "Sometime" } })).toBeNull();
    expect(masterlistMonthFromBatch({ id: "w4", validationSummary: { kind: "masterlist" } })).toBeNull();
  });
});
