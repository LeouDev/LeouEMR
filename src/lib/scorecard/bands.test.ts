import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_BANDS,
  CRITICAL_ERROR_BANDS,
  IRE_BANDS,
  LH_UTILIZATION_BANDS,
  NPS_BANDS,
  PKT_BANDS,
  QUALITY_BANDS,
  STANDARD_ERROR_BANDS,
  rateOn,
} from "./bands";

/** The bands exactly as the scorecard workbook prints them, boundary by boundary. */
describe("rateOn", () => {
  it("rates quality on whole-percent cuts", () => {
    expect(rateOn(QUALITY_BANDS, 100)).toBe(5);
    expect(rateOn(QUALITY_BANDS, 99.99)).toBe(4);
    expect(rateOn(QUALITY_BANDS, 99)).toBe(4);
    expect(rateOn(QUALITY_BANDS, 98)).toBe(3);
    expect(rateOn(QUALITY_BANDS, 97.99)).toBe(2);
    expect(rateOn(QUALITY_BANDS, 96)).toBe(2);
    expect(rateOn(QUALITY_BANDS, 95.99)).toBe(1);
  });

  it("rates the six-month critical error count, with 7 already a 1", () => {
    expect(rateOn(CRITICAL_ERROR_BANDS, 0)).toBe(5);
    expect(rateOn(CRITICAL_ERROR_BANDS, 1)).toBe(4);
    expect(rateOn(CRITICAL_ERROR_BANDS, 2)).toBe(3);
    expect(rateOn(CRITICAL_ERROR_BANDS, 4)).toBe(3);
    expect(rateOn(CRITICAL_ERROR_BANDS, 5)).toBe(2);
    expect(rateOn(CRITICAL_ERROR_BANDS, 6)).toBe(2);
    expect(rateOn(CRITICAL_ERROR_BANDS, 7)).toBe(1);
  });

  it("rates the six-month standard error count", () => {
    expect(rateOn(STANDARD_ERROR_BANDS, 0)).toBe(5);
    expect(rateOn(STANDARD_ERROR_BANDS, 2)).toBe(4);
    expect(rateOn(STANDARD_ERROR_BANDS, 3)).toBe(3);
    expect(rateOn(STANDARD_ERROR_BANDS, 8)).toBe(3);
    expect(rateOn(STANDARD_ERROR_BANDS, 9)).toBe(2);
    expect(rateOn(STANDARD_ERROR_BANDS, 14)).toBe(2);
    expect(rateOn(STANDARD_ERROR_BANDS, 15)).toBe(1);
  });

  it("skips the rates a row does not have", () => {
    expect(rateOn(IRE_BANDS, 0)).toBe(5);
    expect(rateOn(IRE_BANDS, 1)).toBe(3);
    expect(rateOn(IRE_BANDS, 2)).toBe(2);
    expect(rateOn(IRE_BANDS, 3)).toBe(1);

    expect(rateOn(LH_UTILIZATION_BANDS, 71.42)).toBe(5);
    expect(rateOn(LH_UTILIZATION_BANDS, 71.41)).toBe(2);
    expect(rateOn(LH_UTILIZATION_BANDS, 65)).toBe(2);
    expect(rateOn(LH_UTILIZATION_BANDS, 64.99)).toBe(1);
  });

  it("rates PKT, attendance and NPS", () => {
    expect(rateOn(PKT_BANDS, 95)).toBe(4);
    expect(rateOn(PKT_BANDS, 80)).toBe(3);
    expect(rateOn(PKT_BANDS, 69.99)).toBe(1);
    expect(rateOn(ATTENDANCE_BANDS, 100)).toBe(5);
    expect(rateOn(ATTENDANCE_BANDS, 96.5)).toBe(3);
    expect(rateOn(ATTENDANCE_BANDS, 92.99)).toBe(1);
    expect(rateOn(NPS_BANDS, 87)).toBe(5);
    expect(rateOn(NPS_BANDS, 78)).toBe(4);
    expect(rateOn(NPS_BANDS, 70)).toBe(3);
    expect(rateOn(NPS_BANDS, 62)).toBe(2);
    expect(rateOn(NPS_BANDS, 61.99)).toBe(1);
  });
});
