import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, UserRole } from "@/lib/auth/session";

/**
 * Authorization on Quality Audit.
 *
 * Two gates, both exercised through the real action, queries and export
 * route with a mocked database that throws the moment it is touched: the
 * role gate (an agent never audits, never reads the roster, history,
 * analysis or export, and never reaches the database trying) and the
 * scope gate (a leader files audits only for agents on their own roster,
 * refused before anything is read or written).
 */

const currentUser = vi.hoisted(() => ({ value: null as CurrentUser | null }));
const scope = vi.hoisted(() => ({ ids: [] as string[] }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => currentUser.value }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/queries/performance", () => ({ resolveScopedIds: async () => scope.ids }));
vi.mock("@/lib/queries/eligibility", () => ({ separationDates: async () => new Map() }));
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

const { submitAudit } = await import("./actions");
const { NOT_A_LEADER, OUT_OF_SCOPE } = await import("@/lib/quality/messages");
const { GET } = await import("./export/route");
const { getQaAgentOptions, getQaAnalysisInput, getQaExport, getQaHistory, getQaRoster } = await import(
  "@/lib/queries/quality"
);
const { auditWeekOf } = await import("@/lib/quality/week");
const { windowFor } = await import("@/lib/quality/analysis");

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

const AGENT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_AGENT_ID = "33333333-3333-4333-8333-333333333333";
const week = auditWeekOf("2026-09-09");
const window = windowFor("daily", "2026-09-13");

const filing = () => ({ agentId: AGENT_ID, formKey: "phone", auditDate: "2026-09-09", marks: {}, remarks: {}, headerValues: {} });

beforeEach(() => {
  currentUser.value = null;
  scope.ids = [];
});

describe("an agent", () => {
  beforeEach(() => {
    currentUser.value = signedInAs("agent");
  });

  it("cannot file an audit, and the database is never reached", async () => {
    expect(await submitAudit(filing())).toEqual({ ok: false, error: NOT_A_LEADER });
  });

  it("reads nothing from any Quality Audit query", async () => {
    const user = currentUser.value!;
    expect(await getQaRoster(user, week)).toMatchObject({ rows: [], required: 0, completed: 0 });
    expect(await getQaAgentOptions(user)).toEqual([]);
    expect(await getQaHistory(user)).toEqual([]);
    expect(await getQaExport(user, null)).toEqual([]);
    expect(await getQaAnalysisInput(user, window)).toEqual({ audits: [], fails: [] });
  });

  it("is refused by the export route", async () => {
    const response = await GET(new Request("https://emr.example.test/quality/export"));
    expect(response.status).toBe(403);
  });
});

describe("signed out", () => {
  it("cannot file an audit or download an export", async () => {
    expect(await submitAudit(filing())).toEqual({ ok: false, error: "Not signed in" });
    expect((await GET(new Request("https://emr.example.test/quality/export"))).status).toBe(403);
  });
});

describe.each<UserRole>(["supervisor", "manager", "admin"])("a %s", (role) => {
  beforeEach(() => {
    currentUser.value = signedInAs(role);
    scope.ids = [AGENT_ID];
  });

  it("cannot file an audit for an agent outside their roster — refused before any read or write", async () => {
    expect(await submitAudit({ ...filing(), agentId: OTHER_AGENT_ID })).toEqual({ ok: false, error: OUT_OF_SCOPE });
  });

  it("cannot file an audit dated in the future", async () => {
    expect(await submitAudit({ ...filing(), auditDate: "2999-01-01" })).toEqual({
      ok: false,
      error: "The audit date cannot be in the future.",
    });
  });

  it("is refused a malformed export id before any read", async () => {
    const response = await GET(new Request("https://emr.example.test/quality/export?audit=not-a-uuid"));
    expect(response.status).toBe(400);
  });
});
