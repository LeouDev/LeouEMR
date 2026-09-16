import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/auth/session";

/**
 * updateUser is where a pending account's self-reported employeeEid claim
 * either becomes real scope or doesn't — the same claim signup lets anyone
 * type. These pin down the check added here: an EID that matches nobody in
 * the roster must never save, the same way a role claim is never trusted on
 * its own (see the comment beside IMPLIED_ROLE in user-table.tsx). Before
 * this check existed, nothing stopped a typo — or a guess — from linking an
 * account to a person it doesn't belong to.
 */

const currentUser = vi.hoisted(() => ({ value: null as CurrentUser | null }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => currentUser.value }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// `after` defers work until the response is done, which needs a request
// scope these tests have none of. Running the callback where it was handed
// over keeps what the tests are actually about — that the send is asked for,
// and asked for only after the audit row exists — while proving the action
// no longer waits on it.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (callback: () => unknown) => {
    void callback();
  },
}));

// The Supabase admin API: an approval marks the email confirmed through it.
// Each call is recorded; `refuse` makes the fake answer with an error the
// way auth-js does (returned, not thrown).
const adminApi = vi.hoisted(() => ({
  calls: [] as Array<{ userId: string; attributes: Record<string, unknown> }>,
  refuse: false,
  updateUserById: async (userId: string, attributes: Record<string, unknown>) => {
    adminApi.calls.push({ userId, attributes });
    return adminApi.refuse ? { data: { user: null }, error: { message: "refused" } } : { data: { user: {} }, error: null };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ auth: { admin: { updateUserById: adminApi.updateUserById } } }),
}));

// The welcome email. The real one opens an SMTP connection, so only the
// decision to send is exercised here — who it is asked to write to, and
// what the action does when the relay will not take it.
const welcomeMail = vi.hoisted(() => ({
  batches: [] as Array<Array<{ id: string; email: string; role: string }>>,
  deliver: true,
  /** How many audit rows existed when the relay was first contacted. */
  auditRowsAtSendTime: -1,
  countAuditRows: (): number => 0,
  send: async (recipients: Array<{ id: string; email: string; role: string }>) => {
    welcomeMail.auditRowsAtSendTime = welcomeMail.countAuditRows();
    welcomeMail.batches.push(recipients);
    return recipients.map(() => welcomeMail.deliver);
  },
}));
vi.mock("@/lib/mail/send-welcome", () => ({ sendWelcomeEmails: welcomeMail.send }));

// Real `eq` builds a SQL AST node for a real database to evaluate. Replacing
// it with a row-predicate closure lets the fake `db` below actually filter
// in-memory tables by whichever column the action really queried; `and`,
// `ne` and `inArray` combine the same way so the bulk approval's filter
// runs too.
type Predicate = (row: Record<string, unknown>) => boolean;
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (column: { name: string }, value: unknown) => (row: Record<string, unknown>) => row[column.name] === value,
    ne: (column: { name: string }, value: unknown) => (row: Record<string, unknown>) => row[column.name] !== value,
    inArray: (column: { name: string }, values: unknown[]) => (row: Record<string, unknown>) =>
      values.includes(row[column.name]),
    and:
      (...predicates: Predicate[]) =>
      (row: Record<string, unknown>) =>
        predicates.every((predicate) => predicate(row)),
  };
});

const tableName = (t: unknown) => (t as Record<symbol, string>)[Symbol.for("drizzle:Name")];

let usersRows: Array<Record<string, unknown>> = [];
let employeesRows: Array<Record<string, unknown>> = [];
let assignmentsRows: Array<Record<string, unknown>> = [];
const auditRows: Array<Record<string, unknown>> = [];

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: (pred: (row: Record<string, unknown>) => boolean) => ({
          limit: () => {
            const name = tableName(table);
            const rows = name === "employees" ? employeesRows : name === "employee_assignments" ? assignmentsRows : usersRows;
            // Real Drizzle hands rows back under the schema's camelCase
            // names; the fake rows are keyed the way the predicates read
            // them, so the two columns the action reads back are mapped.
            return Promise.resolve(
              rows.filter(pred).map((row) => ({ ...row, employeeEid: row.employee_eid, managerName: row.manager_name })),
            );
          },
        }),
      }),
    }),
    update: (table: unknown) => ({
      // `set()` is keyed by the schema's camelCase property names, the same
      // as real Drizzle — mapped here to the snake_case columns the fake
      // rows use, since the mock does none of that translation on its own.
      // Only the columns actually set are written, so a partial update (the
      // bulk approval sets status alone) leaves the rest of the row intact.
      set: (values: Record<string, unknown>) => ({
        where: (pred: (row: Record<string, unknown>) => boolean) => {
          const touched: Array<Record<string, unknown>> = [];
          if (tableName(table) === "users") {
            const mapped: Record<string, unknown> = {};
            if ("role" in values) mapped.role = values.role;
            if ("status" in values) mapped.status = values.status;
            if ("employeeEid" in values) mapped.employee_eid = values.employeeEid;
            if ("managerName" in values) mapped.manager_name = values.managerName;
            if ("email" in values) mapped.email = values.email;
            usersRows = usersRows.map((row) => {
              if (!pred(row)) return row;
              const next = { ...row, ...mapped };
              touched.push(next);
              return next;
            });
          }
          // Awaitable on its own, and `.returning()` hands back the rows
          // the update touched, under the keys the action asked for.
          return Object.assign(Promise.resolve(undefined), {
            returning: (columns: Record<string, { name: string }>) =>
              Promise.resolve(
                touched.map((row) =>
                  Object.fromEntries(Object.entries(columns).map(([key, column]) => [key, row[column.name]])),
                ),
              ),
          });
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown> | Array<Record<string, unknown>>) => {
        if (tableName(table) === "audit_log") auditRows.push(...(Array.isArray(v) ? v : [v]));
        return Promise.resolve(undefined);
      },
    }),
  },
}));

const { approvePendingUsers, updateUser } = await import("./actions");

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const REAL_EID = "001895123";
/** A team leader's ID: on the roster only as the supervisor of an agent row. */
const LEADER_EID = "001305110";

beforeEach(() => {
  currentUser.value = {
    id: ADMIN_ID,
    email: "admin@example.test",
    name: "Test Admin",
    role: "admin",
    status: "active",
    employeeEid: null,
    managerName: null,
  };
  usersRows = [
    { id: ADMIN_ID, name: "Test Admin", email: "admin@example.test", employee_eid: null, role: "admin", status: "active", manager_name: null },
    { id: TARGET_ID, name: "Pending Agent", email: "pending@example.test", employee_eid: null, role: "agent", status: "pending", manager_name: null },
  ];
  employeesRows = [{ id: "employee-1", eid: REAL_EID, supervisor_eid: LEADER_EID }];
  assignmentsRows = [];
  auditRows.length = 0;
  adminApi.calls.length = 0;
  adminApi.refuse = false;
});

const signedInAsAdmin = (): CurrentUser => ({
  id: ADMIN_ID,
  email: "admin@example.test",
  name: "Test Admin",
  role: "admin",
  status: "active",
  employeeEid: null,
  managerName: null,
});

const input = (over: Partial<Record<string, unknown>> = {}) => ({
  userId: TARGET_ID,
  role: "agent",
  status: "active",
  employeeEid: REAL_EID,
  ...over,
});

describe("linking an account to an employee ID", () => {
  it("refuses an EID that matches nobody on the roster", async () => {
    const result = await updateUser(input({ employeeEid: "999999999" }));
    expect(result).toEqual({
      ok: false,
      error:
        "No employee or team leader found with ID 999999999 — check for a typo, or confirm they're in the imported roster.",
    });
    expect(usersRows.find((r) => r.id === TARGET_ID)?.employee_eid).toBeNull();
  });

  it("saves once the EID resolves to a real employee", async () => {
    const result = await updateUser(input({ employeeEid: REAL_EID }));
    expect(result).toEqual({ ok: true });
    expect(usersRows.find((r) => r.id === TARGET_ID)?.employee_eid).toBe(REAL_EID);
  });

  it("still catches two accounts claiming the same real EID, after confirming it's real", async () => {
    usersRows.push({
      id: "33333333-3333-4333-8333-333333333333",
      name: "Already Linked",
      employee_eid: REAL_EID,
      role: "agent",
      status: "active",
      manager_name: null,
    });
    const result = await updateUser(input({ employeeEid: REAL_EID }));
    expect(result).toEqual({ ok: false, error: `Employee ID ${REAL_EID} is already linked to Already Linked` });
  });

  it("accepts a team leader's ID, which is on the roster only as their reports' supervisor", async () => {
    const result = await updateUser(input({ role: "supervisor", employeeEid: LEADER_EID }));
    expect(result).toEqual({ ok: true });
    expect(usersRows.find((r) => r.id === TARGET_ID)?.employee_eid).toBe(LEADER_EID);
  });

  it("accepts a leader's ID known only from the roster's history", async () => {
    employeesRows = [{ id: "employee-1", eid: REAL_EID, supervisor_eid: "somebody-else" }];
    assignmentsRows = [{ id: "stint-1", supervisor_eid: LEADER_EID }];
    const result = await updateUser(input({ role: "supervisor", employeeEid: LEADER_EID }));
    expect(result).toEqual({ ok: true });
  });

  it("does not re-check an ID the administrator did not change, so the rest of the row can still be saved", async () => {
    // A link set before the check existed, matching nothing today.
    usersRows = usersRows.map((r) => (r.id === TARGET_ID ? { ...r, role: "supervisor", employee_eid: "000000001" } : r));
    const result = await updateUser(
      input({ role: "supervisor", employeeEid: "000000001", managerName: "Leou Alven Narito Comendador" }),
    );
    expect(result).toEqual({ ok: true });
    expect(usersRows.find((r) => r.id === TARGET_ID)?.manager_name).toBe("Leou Alven Narito Comendador");
  });

  it("leaves an empty EID alone — nothing to validate against the roster", async () => {
    const result = await updateUser(input({ employeeEid: "" }));
    expect(result).toEqual({ ok: true });
    expect(usersRows.find((r) => r.id === TARGET_ID)?.employee_eid).toBeNull();
  });
});

describe("baseline guards", () => {
  it("refuses a non-admin caller", async () => {
    currentUser.value = { ...currentUser.value!, role: "supervisor" };
    const result = await updateUser(input());
    expect(result).toEqual({ ok: false, error: "Only administrators can manage users" });
  });

  it("refuses an admin editing their own account", async () => {
    const result = await updateUser(input({ userId: ADMIN_ID }));
    expect(result).toEqual({ ok: false, error: "You cannot change your own role or status" });
  });
});

/**
 * Approving an account also marks its email address confirmed in Supabase
 * Auth — company mailboxes filter the confirmation email often enough that
 * approved people were still locked out at sign-in. Only an approval does
 * it: a save that leaves the account pending, or re-enables a disabled one,
 * never touches the address. A refusal from Supabase is reported, not
 * fatal: the approval stands and the emailed link still works.
 */
describe("approval confirms the email address", () => {
  const confirmations = () => adminApi.calls.filter((call) => call.attributes.email_confirm === true);

  it("marks the address confirmed when a single-row save activates a pending account", async () => {
    const result = await updateUser(input());
    expect(result).toEqual({ ok: true });
    expect(confirmations().map((call) => call.userId)).toEqual([TARGET_ID]);
    expect(auditRows[0]?.after).toMatchObject({ status: "active", emailConfirmed: true });
  });

  it("leaves the address alone when the save keeps the account pending", async () => {
    await updateUser(input({ status: "pending" }));
    expect(confirmations()).toEqual([]);
    expect(auditRows[0]?.after).not.toHaveProperty("emailConfirmed");
  });

  it("leaves the address alone when re-enabling a disabled account — that is not an approval", async () => {
    usersRows[1] = { ...usersRows[1], status: "disabled" };
    await updateUser(input());
    expect(confirmations()).toEqual([]);
  });

  it("still saves, with a warning, when Supabase refuses the confirmation", async () => {
    adminApi.refuse = true;
    const result = await updateUser(input());
    expect(result.ok).toBe(true);
    expect(result.ok && result.warning).toMatch(/could not be marked confirmed/);
    expect(usersRows[1]?.status).toBe("active");
    expect(auditRows[0]?.after).toMatchObject({ emailConfirmed: false });
  });

  it("confirms every account the bulk approval activates, and only those", async () => {
    const OTHER_ID = "33333333-3333-4333-8333-333333333333";
    const ALREADY_ACTIVE_ID = "44444444-4444-4444-8444-444444444444";
    usersRows.push(
      { id: OTHER_ID, name: "Second Pending", employee_eid: null, role: "agent", status: "pending", manager_name: null },
      { id: ALREADY_ACTIVE_ID, name: "Active", employee_eid: null, role: "agent", status: "active", manager_name: null },
    );
    const result = await approvePendingUsers({ userIds: [TARGET_ID, OTHER_ID, ALREADY_ACTIVE_ID, ADMIN_ID] });
    expect(result).toEqual({ ok: true, approved: 2, unconfirmed: 0 });
    expect(confirmations().map((call) => call.userId).sort()).toEqual([TARGET_ID, OTHER_ID].sort());
    expect(auditRows).toHaveLength(2);
    expect(auditRows.every((row) => row.action === "user.approved")).toBe(true);
    expect(auditRows.map((row) => (row.after as { emailConfirmed: boolean }).emailConfirmed)).toEqual([true, true]);
  });

  it("counts the addresses the bulk approval could not confirm, and approves them anyway", async () => {
    adminApi.refuse = true;
    const result = await approvePendingUsers({ userIds: [TARGET_ID] });
    expect(result).toEqual({ ok: true, approved: 1, unconfirmed: 1 });
    expect(usersRows[1]?.status).toBe("active");
    expect(auditRows[0]?.after).toMatchObject({ status: "active", emailConfirmed: false });
  });
});

/**
 * An administrator may change an account's sign-in address. It goes to
 * Supabase Auth first, confirmed, and only then to the users row; a
 * company domain when the deployment names them; never another account's.
 */
describe("changing an account's email address", () => {
  const original = process.env.SIGNUP_EMAIL_DOMAINS;
  beforeEach(() => {
    currentUser.value = signedInAsAdmin();
    process.env.SIGNUP_EMAIL_DOMAINS = "example.test";
  });
  afterEach(() => {
    process.env.SIGNUP_EMAIL_DOMAINS = original;
  });

  it("sets the new address in Supabase Auth, confirmed, then on the row", async () => {
    const result = await updateUser(input({ email: " New.Agent@Example.test " }));
    expect(result).toEqual({ ok: true });
    const call = adminApi.calls.find((c) => "email" in c.attributes);
    expect(call).toEqual({ userId: TARGET_ID, attributes: { email: "new.agent@example.test", email_confirm: true } });
    expect(usersRows[1]?.email).toBe("new.agent@example.test");
    expect(auditRows[0]?.before).toMatchObject({ email: "pending@example.test" });
    expect(auditRows[0]?.after).toMatchObject({ email: "new.agent@example.test" });
  });

  it("leaves the address alone when it is unchanged, whatever the case", async () => {
    await updateUser(input({ email: "PENDING@example.test" }));
    expect(adminApi.calls.some((c) => "email" in c.attributes)).toBe(false);
    expect(usersRows[1]?.email).toBe("pending@example.test");
  });

  it("refuses an address outside the company domains", async () => {
    expect(await updateUser(input({ email: "agent@gmail.com" }))).toEqual({
      ok: false,
      error: "Use a company email address (@example.test).",
    });
    expect(usersRows[1]?.email).toBe("pending@example.test");
  });

  it("refuses another account's address", async () => {
    expect(await updateUser(input({ email: "admin@example.test" }))).toEqual({
      ok: false,
      error: "That email address belongs to another account",
    });
  });

  it("refuses an address that is not one", async () => {
    expect(await updateUser(input({ email: "not-an-address" }))).toEqual({ ok: false, error: "Enter a valid email address" });
  });

  it("writes nothing when Supabase refuses the change", async () => {
    adminApi.refuse = true;
    const result = await updateUser(input({ email: "new@example.test" }));
    expect(result).toEqual({ ok: false, error: "Could not change their sign-in email: refused" });
    expect(usersRows[1]?.email).toBe("pending@example.test");
    expect(usersRows[1]?.status).toBe("pending");
    expect(auditRows).toHaveLength(0);
  });
});

/**
 * The welcome email goes out on approval, and only on approval. It is best
 * effort by design: the account is already active by the time the relay is
 * asked, so nothing it does may change what the administrator is told.
 */
describe("the welcome email on approval", () => {
  const TARGET_ID = "22222222-2222-4222-8222-222222222222";
  const ADMIN_ID = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    welcomeMail.batches = [];
    welcomeMail.deliver = true;
    welcomeMail.auditRowsAtSendTime = -1;
    welcomeMail.countAuditRows = () => auditRows.length;
    adminApi.refuse = false;
    currentUser.value = { id: ADMIN_ID, role: "admin", status: "active" } as CurrentUser;
    usersRows = [
      { id: ADMIN_ID, name: "Admin", employee_eid: null, role: "admin", status: "active", manager_name: null },
      {
        id: TARGET_ID,
        name: "Dela Cruz, Juan",
        email: "juan@example.com",
        employee_eid: null,
        role: "agent",
        status: "pending",
        manager_name: null,
      },
    ];
    employeesRows = [];
    assignmentsRows = [];
    auditRows.length = 0;
  });

  it("writes to each account the bulk approval activated", async () => {
    const { approvePendingUsers } = await import("./actions");
    await approvePendingUsers({ userIds: [TARGET_ID] });

    expect(welcomeMail.batches).toHaveLength(1);
    expect(welcomeMail.batches[0].map((r) => r.id)).toEqual([TARGET_ID]);
    expect(auditRows[0]?.after).toMatchObject({ status: "active", emailConfirmed: true });
  });

  /**
   * The accounts are already active before any mail is attempted, so every
   * second spent on the relay is a second the approval could be lost to the
   * platform's time limit with nothing in the log saying who did it. The
   * audit row goes in first; delivery is recorded in the platform log.
   */
  it("records the approval before the relay is contacted, not after", async () => {
    const { approvePendingUsers } = await import("./actions");
    await approvePendingUsers({ userIds: [TARGET_ID] });

    expect(welcomeMail.auditRowsAtSendTime).toBe(1);
  });

  it("skips anyone whose address could not be confirmed — they still owe the confirm link", async () => {
    adminApi.refuse = true;
    const { approvePendingUsers } = await import("./actions");
    const result = await approvePendingUsers({ userIds: [TARGET_ID] });

    expect(result).toEqual({ ok: true, approved: 1, unconfirmed: 1 });
    expect(welcomeMail.batches[0] ?? []).toEqual([]);
    expect(auditRows[0]?.after).toMatchObject({ status: "active", emailConfirmed: false });
  });

  it("approves anyway when the relay will not take the message", async () => {
    welcomeMail.deliver = false;
    const { approvePendingUsers } = await import("./actions");
    const result = await approvePendingUsers({ userIds: [TARGET_ID] });

    expect(result).toEqual({ ok: true, approved: 1, unconfirmed: 0 });
    expect(usersRows.find((row) => row.id === TARGET_ID)?.status).toBe("active");
    // The approval stands on its own record regardless of the relay.
    expect(auditRows[0]?.after).toMatchObject({ status: "active", emailConfirmed: true });
  });

  it("stays quiet when a save is not an approval", async () => {
    usersRows[1].status = "active";
    const { updateUser } = await import("./actions");
    await updateUser({ userId: TARGET_ID, role: "agent", status: "active", employeeEid: "", managerName: "" });

    expect(welcomeMail.batches).toEqual([]);
  });
});
