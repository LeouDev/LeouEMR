import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Period } from "./period";

/**
 * `hasReportableData` makes five reads: one to resolve the ATTENDANCE KPI's
 * id, then one `selectDistinct` against each of skill/quality/nps/metric
 * facts. The stub below routes each call by which table `.from()` was given,
 * so each table can be seeded with its own rows independently — a case
 * would otherwise have no way to make "only metricFacts has a row, and it's
 * the ATTENDANCE one" distinguishable from "metricFacts has a real row".
 */
const seeded = new Map<unknown, Array<{ id: string }>>();
let attendanceKpiId: string | null = "attendance-kpi-id";

vi.mock("@/lib/db/client", async () => {
  const schema = await import("@/lib/db/schema");
  const thenable = <T,>(value: T) => Object.assign(Promise.resolve(value), { limit: () => Promise.resolve(value) });

  const from = (table: unknown) => {
    if (table === schema.kpiDefinitions) {
      return {
        where: () => thenable(attendanceKpiId ? [{ id: attendanceKpiId }] : []),
      };
    }
    return { where: () => thenable(seeded.get(table) ?? []) };
  };

  return {
    db: {
      select: () => ({ from }),
      selectDistinct: () => ({ from }),
    },
  };
});

const { hasReportableData } = await import("./eligibility");
const schema = await import("@/lib/db/schema");

const PERIOD: Period = { granularity: "month", start: "2026-08-01", end: "2026-08-31", label: "August 2026" };

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  seeded.clear();
  attendanceKpiId = "attendance-kpi-id";
});

describe("hasReportableData", () => {
  it("counts an employee with skill facts", () => {
    seeded.set(schema.skillFacts, [{ id: A }]);
    return hasReportableData([A, B], PERIOD).then((r) => {
      expect(r.has(A)).toBe(true);
      expect(r.has(B)).toBe(false);
    });
  });

  it("counts an employee with quality facts alone", async () => {
    seeded.set(schema.qualityFacts, [{ id: A }]);
    expect((await hasReportableData([A, B], PERIOD)).has(A)).toBe(true);
  });

  it("counts an employee with NPS facts alone", async () => {
    seeded.set(schema.npsFacts, [{ id: A }]);
    expect((await hasReportableData([A, B], PERIOD)).has(A)).toBe(true);
  });

  it("counts an employee with a non-attendance metric fact", async () => {
    seeded.set(schema.metricFacts, [{ id: A }]);
    expect((await hasReportableData([A, B], PERIOD)).has(A)).toBe(true);
  });

  it("does not count an employee whose only row anywhere is attendance", async () => {
    // The metricFacts query itself excludes the ATTENDANCE kpi id, so an
    // attendance-only employee produces no row from any of the four reads —
    // exactly the training/LOA/SME case this exists to catch.
    const reporting = await hasReportableData([A], PERIOD);
    expect(reporting.has(A)).toBe(false);
  });

  it("still resolves correctly if the ATTENDANCE kpi definition is somehow missing", async () => {
    attendanceKpiId = null;
    seeded.set(schema.metricFacts, [{ id: A }]);
    expect((await hasReportableData([A], PERIOD)).has(A)).toBe(true);
  });

  it("returns an empty set for an empty roster without querying anything", async () => {
    expect(await hasReportableData([], PERIOD)).toEqual(new Set());
  });

  it("unions data across all four tables rather than requiring all of them", async () => {
    seeded.set(schema.skillFacts, [{ id: A }]);
    seeded.set(schema.qualityFacts, [{ id: B }]);
    const reporting = await hasReportableData([A, B], PERIOD);
    expect(reporting.has(A)).toBe(true);
    expect(reporting.has(B)).toBe(true);
  });
});
