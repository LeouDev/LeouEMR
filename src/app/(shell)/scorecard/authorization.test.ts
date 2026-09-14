import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, UserRole } from "@/lib/auth/session";

/**
 * The two scorecard stamps are gated on role before anything is read: only
 * a team leader reviews, only an agent acknowledges, and a review is refused
 * outright until the month's ten-day grace has passed. The database mock
 * throws on any use, so reaching it proves the gates passed.
 */
const currentUser = vi.hoisted(() => ({ value: null as CurrentUser | null }));

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => currentUser.value,
}));

vi.mock("@/lib/db/client", () => ({
  db: new Proxy(
    {},
    {
      get() {
        throw new Error("database reached before the authorization check");
      },
    },
  ),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { acknowledgeScorecard, reviewScorecard } = await import("./actions");

function signedInAs(role: UserRole): CurrentUser {
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

const EMPLOYEE = "44444444-4444-4444-8444-444444444444";
/** A drawn signature; every stamp needs one. */
const SIGNATURE = { w: 600, h: 200, strokes: [[10, 10, 50, 40, 90, 20]] };
const EMPTY_PAD = { w: 600, h: 200, strokes: [[10, 10]] };
/** A month whose review has long since opened. */
const OLD_MONTH = "2026-01-01";
/** A month that cannot have opened yet: it starts after today. */
const nextYear = new Date().getUTCFullYear() + 1;
const FUTURE_MONTH = `${nextYear}-01-01`;

beforeEach(() => {
  currentUser.value = null;
});

describe("reviewScorecard", () => {
  it.each(["agent", "manager", "admin", "trainer", "sme"] as UserRole[])("refuses %s — only the team leader reviews", async (role) => {
    currentUser.value = signedInAs(role);
    expect(await reviewScorecard({ employeeId: EMPLOYEE, month: OLD_MONTH, signature: SIGNATURE })).toEqual({
      ok: false,
      error: "Only the team leader reviews a scorecard",
    });
  });

  it("refuses a signed-out or pending caller", async () => {
    currentUser.value = null;
    expect(await reviewScorecard({ employeeId: EMPLOYEE, month: OLD_MONTH, signature: SIGNATURE })).toEqual({ ok: false, error: "Not signed in" });
    currentUser.value = { ...signedInAs("supervisor"), status: "pending" };
    expect(await reviewScorecard({ employeeId: EMPLOYEE, month: OLD_MONTH, signature: SIGNATURE })).toEqual({ ok: false, error: "Not signed in" });
  });

  it("rejects a malformed month before any database access", async () => {
    currentUser.value = signedInAs("supervisor");
    expect(await reviewScorecard({ employeeId: EMPLOYEE, month: "2026-09", signature: SIGNATURE })).toEqual({ ok: false, error: "Pick the month" });
  });

  it("refuses an empty signature pad before any database access", async () => {
    currentUser.value = signedInAs("supervisor");
    expect(await reviewScorecard({ employeeId: EMPLOYEE, month: OLD_MONTH, signature: EMPTY_PAD })).toEqual({
      ok: false,
      error: "Draw your signature before confirming",
    });
    currentUser.value = signedInAs("agent");
    expect(await acknowledgeScorecard({ month: OLD_MONTH, signature: EMPTY_PAD })).toEqual({
      ok: false,
      error: "Draw your signature before confirming",
    });
  });

  it("keeps a month locked until ten days after it ends, before any database access", async () => {
    currentUser.value = signedInAs("supervisor");
    const result = await reviewScorecard({ employeeId: EMPLOYEE, month: FUTURE_MONTH, signature: SIGNATURE });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/opens for review on/);
  });

  it("lets a team leader through to the scope check on an open month", async () => {
    currentUser.value = signedInAs("supervisor");
    await expect(reviewScorecard({ employeeId: EMPLOYEE, month: OLD_MONTH, signature: SIGNATURE })).rejects.toThrow(
      "database reached before the authorization check",
    );
  });
});

describe("acknowledgeScorecard", () => {
  it.each(["supervisor", "manager", "admin", "trainer", "sme"] as UserRole[])("refuses %s — only the agent acknowledges", async (role) => {
    currentUser.value = signedInAs(role);
    expect(await acknowledgeScorecard({ month: OLD_MONTH, signature: SIGNATURE })).toEqual({
      ok: false,
      error: "Only the agent named on a scorecard acknowledges it",
    });
  });

  it("refuses an agent whose account is not linked, before any database access", async () => {
    currentUser.value = { ...signedInAs("agent"), employeeEid: null };
    expect(await acknowledgeScorecard({ month: OLD_MONTH, signature: SIGNATURE })).toEqual({
      ok: false,
      error: "Your account is not linked to an employee record",
    });
  });

  it("lets a linked agent through to their own record", async () => {
    currentUser.value = signedInAs("agent");
    await expect(acknowledgeScorecard({ month: OLD_MONTH, signature: SIGNATURE })).rejects.toThrow(
      "database reached before the authorization check",
    );
  });
});
