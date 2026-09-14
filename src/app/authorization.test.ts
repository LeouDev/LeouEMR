import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, UserRole } from "@/lib/auth/session";

/**
 * Authorization on the admin-only mutations.
 *
 * Every one of these actions reads the caller's role from the session, never
 * from its arguments, so these tests drive the real actions with a mocked
 * session rather than asserting on UI state — a hidden button is not a
 * permission check, and the client can always call the action directly.
 *
 * The database mock throws on any use: if a non-admin ever reaches a query,
 * the test fails loudly instead of quietly passing on an empty result.
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

const { updateSkillTarget } = await import("./(shell)/skills/actions");
const { approvePendingUsers, resetMfa, updateUser } = await import("./(shell)/users/actions");
const { createUploadTicket, previewImport, runImport } = await import("./(shell)/import/actions");
const { acknowledge, addRcaNote, saveActionPlan, saveRca, sendToAgent } = await import(
  "./(shell)/action-items/actions"
);

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

/** The roles that must never be able to change configuration or accounts. */
const NON_ADMIN: UserRole[] = ["manager", "supervisor", "agent", "trainer", "sme"];

beforeEach(() => {
  currentUser.value = null;
});

describe("admin-only mutations", () => {
  describe.each(NON_ADMIN)("as %s", (role) => {
    beforeEach(() => {
      currentUser.value = signedInAs(role);
    });

    it("cannot change a skill target", async () => {
      const result = await updateSkillTarget({
        skillId: "22222222-2222-4222-8222-222222222222",
        target: 99,
      });
      expect(result).toEqual({
        ok: false,
        error: "Only administrators can change skill targets",
      });
    });

    it("cannot change another account's role or status", async () => {
      const result = await updateUser({
        userId: "33333333-3333-4333-8333-333333333333",
        role: "admin",
        status: "active",
      });
      expect(result).toEqual({ ok: false, error: "Only administrators can manage users" });
    });

    it("cannot reset someone's authenticator", async () => {
      const result = await resetMfa({ userId: "22222222-2222-4222-8222-222222222222" });
      expect(result).toEqual({ ok: false, error: "Only administrators can reset an authenticator" });
    });

    it("cannot approve pending accounts in bulk", async () => {
      const result = await approvePendingUsers({
        userIds: ["33333333-3333-4333-8333-333333333333"],
      });
      expect(result).toEqual({ ok: false, error: "Only administrators can manage users" });
    });

    it("cannot request an upload ticket", async () => {
      const result = await createUploadTicket("week.xlsx", 1024);
      expect(result).toEqual({ ok: false, error: "Only administrators can import data" });
    });

    it("cannot analyze an uploaded workbook", async () => {
      const result = await previewImport("some-user-id/week.xlsx", "week.xlsx");
      expect(result).toEqual({ ok: false, error: "Only administrators can import data" });
    });

    it("cannot commit an import", async () => {
      const result = await runImport("some-user-id/week.xlsx", "week.xlsx");
      expect(result).toEqual({ ok: false, error: "Only administrators can import data" });
    });
  });

  describe("signed out", () => {
    it("is rejected before any database access", async () => {
      const result = await updateSkillTarget({
        skillId: "22222222-2222-4222-8222-222222222222",
        target: 99,
      });
      expect(result).toEqual({ ok: false, error: "Not signed in" });
    });
  });

  describe("a pending admin", () => {
    it("is rejected until the account is activated", async () => {
      currentUser.value = { ...signedInAs("admin"), status: "pending" };
      const result = await updateUser({
        userId: "33333333-3333-4333-8333-333333333333",
        role: "agent",
        status: "active",
      });
      expect(result).toEqual({ ok: false, error: "Not signed in" });
    });
  });

  describe("an active admin", () => {
    it("is told when there is nothing to approve, before any database access", async () => {
      currentUser.value = signedInAs("admin");
      expect(await approvePendingUsers({ userIds: [] })).toEqual({
        ok: false,
        error: "Nothing to approve",
      });
    });

    it("passes the role check and proceeds to the database", async () => {
      currentUser.value = signedInAs("admin");
      // The db mock throws on first use, which is the proof: the admin got
      // past every authorization gate and reached the query the other roles
      // never reach.
      await expect(
        updateSkillTarget({ skillId: "22222222-2222-4222-8222-222222222222", target: 99 }),
      ).rejects.toThrow("database reached before the authorization check");
    });
  });
});

/**
 * Notes against a root cause are a write to a performance record, so they
 * carry the same two gates as every other write: the caller must hold a role
 * that manages action items, and the item must be inside their own scope.
 */
describe("RCA notes", () => {
  const valid = {
    actionItemId: "44444444-4444-4444-8444-444444444444",
    week: "2026-08-15",
    note: "Absences this week were illness, not the shift pattern.",
  };

  it.each(["agent"] as UserRole[])("refuses %s outright", async (role) => {
    currentUser.value = signedInAs(role);
    expect(await addRcaNote(valid)).toEqual({
      ok: false,
      error: "Only supervisors and administrators can add a note",
    });
  });

  it("refuses a signed-out caller", async () => {
    currentUser.value = null;
    expect(await addRcaNote(valid)).toEqual({ ok: false, error: "Not signed in" });
  });

  it("refuses a pending account", async () => {
    currentUser.value = { ...signedInAs("supervisor"), status: "pending" };
    expect(await addRcaNote(valid)).toEqual({ ok: false, error: "Not signed in" });
  });

  it("rejects a malformed week before any database access", async () => {
    currentUser.value = signedInAs("supervisor");
    expect(await addRcaNote({ ...valid, week: "15/08/2026" })).toEqual({
      ok: false,
      error: "Pick the week the note is about",
    });
  });

  it("rejects an empty note", async () => {
    currentUser.value = signedInAs("supervisor");
    expect(await addRcaNote({ ...valid, note: "   " })).toEqual({
      ok: false,
      error: "Enter a note",
    });
  });

  it("lets a supervisor through to the scope check", async () => {
    currentUser.value = signedInAs("supervisor");
    // The db mock throws on first use — reaching it proves the role gate
    // passed and the scope lookup was actually attempted, rather than the
    // call being short-circuited.
    await expect(addRcaNote(valid)).rejects.toThrow(
      "database reached before the authorization check",
    );
  });
});

/**
 * The rest of the action-item workflow carries the same two gates as the
 * notes: a managing role, then the caller's own scope. The acknowledgement
 * is the one write gated the other way round — the agent role alone, since
 * nobody acknowledges a plan on an agent's behalf, whatever their rank.
 */
describe("RCA, action plan and send to agent", () => {
  const rca = {
    actionItemId: "44444444-4444-4444-8444-444444444444",
    problemStatement: "Handle time has been over target for three weeks.",
    rootCauseCategoryId: "22222222-2222-4222-8222-222222222222",
    rootCauseDetails: "Long holds while the second system loads.",
    contributingFactors: "",
    evidenceNotes: "",
  };
  const plan = {
    actionItemId: rca.actionItemId,
    correctiveAction: "Side-by-side on the second system twice a week.",
    expectedBehavior: "Holds under a minute on ordinary calls.",
    targetMetric: "AHT",
    targetValue: 540,
    dueDate: "2026-10-01",
    followUpDate: "2026-10-15",
    coachingRequired: true,
    trainingRequired: false,
    supervisorNotes: "",
  };

  it.each(["agent", "manager"] as UserRole[])("refuses %s outright", async (role) => {
    currentUser.value = signedInAs(role);
    expect(await saveRca(rca)).toEqual({
      ok: false,
      error: "Only supervisors and administrators can enter an RCA",
    });
    expect(await saveActionPlan(plan)).toEqual({
      ok: false,
      error: "Only supervisors and administrators can enter an action plan",
    });
    expect(await sendToAgent(rca.actionItemId)).toEqual({
      ok: false,
      error: "Only supervisors and administrators can send an action item",
    });
  });

  it("refuses a signed-out caller", async () => {
    currentUser.value = null;
    expect(await saveRca(rca)).toEqual({ ok: false, error: "Not signed in" });
    expect(await saveActionPlan(plan)).toEqual({ ok: false, error: "Not signed in" });
    expect(await sendToAgent(rca.actionItemId)).toEqual({ ok: false, error: "Not signed in" });
  });

  it("refuses a pending account", async () => {
    currentUser.value = { ...signedInAs("supervisor"), status: "pending" };
    expect(await saveRca(rca)).toEqual({ ok: false, error: "Not signed in" });
    expect(await saveActionPlan(plan)).toEqual({ ok: false, error: "Not signed in" });
    expect(await sendToAgent(rca.actionItemId)).toEqual({ ok: false, error: "Not signed in" });
  });

  it("rejects an incomplete RCA before any database access", async () => {
    currentUser.value = signedInAs("supervisor");
    expect(await saveRca({ ...rca, problemStatement: "Short" })).toEqual({
      ok: false,
      error: "Describe the problem in at least 10 characters",
    });
  });

  it("rejects a plan with no due date before any database access", async () => {
    currentUser.value = signedInAs("supervisor");
    expect(await saveActionPlan({ ...plan, dueDate: "" })).toEqual({
      ok: false,
      error: "Set a due date",
    });
  });

  it.each(["supervisor", "trainer", "sme", "admin"] as UserRole[])(
    "lets %s through to the scope check",
    async (role) => {
      currentUser.value = signedInAs(role);
      await expect(saveRca(rca)).rejects.toThrow("database reached before the authorization check");
      await expect(saveActionPlan(plan)).rejects.toThrow(
        "database reached before the authorization check",
      );
      await expect(sendToAgent(rca.actionItemId)).rejects.toThrow(
        "database reached before the authorization check",
      );
    },
  );
});

describe("acknowledgement", () => {
  const actionItemId = "44444444-4444-4444-8444-444444444444";

  it.each(["admin", "manager", "supervisor", "trainer", "sme"] as UserRole[])(
    "refuses %s — only the agent named on the item acknowledges it",
    async (role) => {
      currentUser.value = signedInAs(role);
      expect(await acknowledge(actionItemId)).toEqual({
        ok: false,
        error: "Only the agent named on an action item can acknowledge it",
      });
    },
  );

  it("refuses a signed-out caller", async () => {
    currentUser.value = null;
    expect(await acknowledge(actionItemId)).toEqual({ ok: false, error: "Not signed in" });
  });

  it("lets an agent through to the scope check", async () => {
    currentUser.value = signedInAs("agent");
    await expect(acknowledge(actionItemId)).rejects.toThrow(
      "database reached before the authorization check",
    );
  });
});
