import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, UserRole } from "@/lib/auth/session";

/**
 * Authorization on My Quality Scores.
 *
 * The page's query and the acknowledgement action are the agent's own and
 * nobody else's: a leader gets nothing from the query and cannot
 * acknowledge, an unlinked agent is refused before any read, and in every
 * refused case the database is never reached. Which audit an agent may
 * acknowledge is decided in SQL (the audit must belong to their employee
 * row), exercised against a real database rather than here.
 */

const currentUser = vi.hoisted(() => ({ value: null as CurrentUser | null }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => currentUser.value }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/queries/performance", () => ({ resolveScopedIds: async () => [] }));
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

const { acknowledgeAudit } = await import("./actions");
const { getMyQualityScores } = await import("@/lib/queries/quality");
const { NOT_AN_AGENT, NOT_LINKED } = await import("@/lib/quality/messages");

function signedInAs(role: UserRole, employeeEid: string | null = "001895123"): CurrentUser {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: `${role}@example.test`,
    name: `Test ${role}`,
    role,
    status: "active",
    employeeEid,
    managerName: null,
  };
}

const AUDIT_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  currentUser.value = null;
});

describe.each<UserRole>(["supervisor", "manager", "admin", "trainer", "sme"])("a %s", (role) => {
  beforeEach(() => {
    currentUser.value = signedInAs(role);
  });

  it("reads nothing from the agent's page query", async () => {
    expect(await getMyQualityScores(currentUser.value!)).toBeNull();
  });

  it("cannot acknowledge an audit", async () => {
    expect(await acknowledgeAudit({ auditId: AUDIT_ID })).toEqual({ ok: false, error: NOT_AN_AGENT });
  });
});

describe("an agent whose account is not linked to an employee", () => {
  beforeEach(() => {
    currentUser.value = signedInAs("agent", null);
  });

  it("is refused before any read or write", async () => {
    expect(await getMyQualityScores(currentUser.value!)).toBeNull();
    expect(await acknowledgeAudit({ auditId: AUDIT_ID })).toEqual({ ok: false, error: NOT_LINKED });
  });
});

describe("signed out", () => {
  it("cannot acknowledge", async () => {
    expect(await acknowledgeAudit({ auditId: AUDIT_ID })).toEqual({ ok: false, error: "Not signed in" });
  });
});

describe("a linked agent", () => {
  it("is refused a malformed audit id before any read", async () => {
    currentUser.value = signedInAs("agent");
    const result = await acknowledgeAudit({ auditId: "nope" });
    expect(result.ok).toBe(false);
  });
});
