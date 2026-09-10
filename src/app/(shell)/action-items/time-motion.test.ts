import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, UserRole } from "@/lib/auth/session";

/**
 * Authorization and scoring on recording a Time & Motion study.
 *
 * Three gates matter here, each independent of the others: the caller's
 * role, whether the item is inside their scope, and whether the item's KPI
 * is actually AHT — a supervisor should not be able to attach a call-timing
 * study to an Attendance item by posting the right shape of request. The
 * status per segment is also asserted to come from the server's own
 * computation, not whatever the client happened to submit.
 */

const currentUser = vi.hoisted(() => ({ value: null as CurrentUser | null }));
const stored = vi.hoisted(() => ({
  item: null as null | Record<string, unknown>,
  kpi: null as null | Record<string, unknown>,
  inserted: [] as unknown[],
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => currentUser.value }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Drizzle stamps every table with its name under this symbol, which is how
// the mock tells the two different SELECTs apart.
const tableName = (t: unknown) => (t as Record<symbol, string>)[Symbol.for("drizzle:Name")];

function selectChain(table: unknown): unknown {
  const rows = () => {
    if (tableName(table) === "kpi_definitions") return stored.kpi ? [stored.kpi] : [];
    return stored.item ? [stored.item] : [];
  };
  const terminal = { where: () => ({ limit: async () => rows() }) };
  return { ...terminal, innerJoin: () => selectChain(table), leftJoin: () => selectChain(table) };
}

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({ from: (table: unknown) => selectChain(table) }),
    insert: (table: unknown) => ({
      values: async (values: unknown) => {
        stored.inserted.push({ table: tableName(table), values });
      },
    }),
  },
}));

const { saveTimeMotionStudy } = await import("./actions");

function user(role: UserRole): CurrentUser {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: `${role}@example.test`,
    name: `Test ${role}`,
    role,
    status: "active",
    employeeEid: "001895123",
    managerName: null,
  };
}

const ACTION_ITEM_ID = "22222222-2222-4222-8222-222222222222";

function input(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    actionItemId: ACTION_ITEM_ID,
    callReference: "CR-0000123",
    remarks: "Escalated to a pharmacist for the investigation step.",
    segments: [
      { code: "opening", label: "Opening & Verification", baselineSeconds: 30, actualSeconds: 28 },
      { code: "investigation", label: "Investigation", baselineSeconds: 120, actualSeconds: 170 },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  currentUser.value = null;
  stored.item = { actionItem: {}, issue: { kpiId: "kpi-aht" }, employee: {} };
  stored.kpi = { code: "AHT", direction: "lower_is_better", skillReferenceId: null };
  stored.inserted = [];
});

describe("saveTimeMotionStudy", () => {
  it("refuses a signed-out caller before touching the database", async () => {
    expect(await saveTimeMotionStudy(input())).toEqual({ ok: false, error: "Not signed in" });
    expect(stored.inserted).toHaveLength(0);
  });

  it("refuses an agent — only supervisors and administrators record a study", async () => {
    currentUser.value = user("agent");
    expect(await saveTimeMotionStudy(input())).toEqual({
      ok: false,
      error: "Only supervisors and administrators can record a study",
    });
    expect(stored.inserted).toHaveLength(0);
  });

  it("refuses a manager, matching every other action-item mutation", async () => {
    currentUser.value = user("manager");
    expect(await saveTimeMotionStudy(input())).toEqual({
      ok: false,
      error: "Only supervisors and administrators can record a study",
    });
  });

  it("refuses an item outside the caller's scope", async () => {
    currentUser.value = user("supervisor");
    stored.item = null;
    expect(await saveTimeMotionStudy(input())).toEqual({
      ok: false,
      error: "Action item not found",
    });
    expect(stored.inserted).toHaveLength(0);
  });

  it("refuses an item whose KPI is not about handle time", async () => {
    currentUser.value = user("supervisor");
    stored.kpi = { code: "ATTENDANCE", direction: "higher_is_better", skillReferenceId: null };
    expect(await saveTimeMotionStudy(input())).toEqual({
      ok: false,
      error: "Time and motion applies to handle-time items",
    });
    expect(stored.inserted).toHaveLength(0);
  });

  it("accepts a handle-time skill's own item, such as Gen_Phones", async () => {
    currentUser.value = user("supervisor");
    stored.kpi = { code: "SKILL_GEN_PHONES", direction: "lower_is_better", skillReferenceId: "ref-gen" };
    expect(await saveTimeMotionStudy(input())).toEqual({ ok: true });
    expect(stored.inserted.some((i) => (i as { table: string }).table === "time_motion_studies")).toBe(true);
  });

  it("refuses a cases-per-hour skill's item — timing a call explains nothing there", async () => {
    currentUser.value = user("supervisor");
    stored.kpi = { code: "SKILL_OCN", direction: "higher_is_better", skillReferenceId: "ref-ocn" };
    expect(await saveTimeMotionStudy(input())).toEqual({
      ok: false,
      error: "Time and motion applies to handle-time items",
    });
    expect(stored.inserted).toHaveLength(0);
  });

  it("rejects a study with no segments before touching the database", async () => {
    currentUser.value = user("supervisor");
    expect(await saveTimeMotionStudy(input({ segments: [] }))).toEqual({
      ok: false,
      error: "Time at least one segment",
    });
    expect(stored.inserted).toHaveLength(0);
  });

  it("computes status per segment on the server rather than trusting the client", async () => {
    currentUser.value = user("admin");
    const result = await saveTimeMotionStudy(input());
    expect(result).toEqual({ ok: true });

    const write = stored.inserted.find((i) => (i as { table: string }).table === "time_motion_studies") as {
      values: Record<string, unknown>;
    };
    const segments = write.values.segments as Array<{ code: string; status: string }>;
    // 28 <= 30 baseline -> good. 170 over a 120 baseline is 41.7% over -> bad.
    expect(segments.find((s) => s.code === "opening")?.status).toBe("good");
    expect(segments.find((s) => s.code === "investigation")?.status).toBe("bad");
    expect(write.values.totalActualSeconds).toBe(198);
    expect(write.values.totalBaselineSeconds).toBe(150);
  });

  it("ignores a client-submitted status rather than trusting it", async () => {
    currentUser.value = user("supervisor");
    await saveTimeMotionStudy(
      input({
        segments: [
          // A crafted request claiming "good" for a wildly over-baseline segment.
          { code: "opening", label: "Opening", baselineSeconds: 10, actualSeconds: 200, status: "good" },
        ],
      }),
    );
    const write = stored.inserted.find((i) => (i as { table: string }).table === "time_motion_studies") as {
      values: Record<string, unknown>;
    };
    const segments = write.values.segments as Array<{ status: string }>;
    expect(segments[0].status).toBe("bad");
  });

  it("records an audit entry alongside the study", async () => {
    currentUser.value = user("supervisor");
    await saveTimeMotionStudy(input());
    expect(stored.inserted.some((i) => (i as { table: string }).table === "audit_log")).toBe(true);
  });
});
