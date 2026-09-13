import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/auth/session";

/**
 * The profile panel's save: the signed-in person's own row and nothing
 * else. Signed out and malformed input are refused before the database is
 * touched; the update carries only the editable columns — never the
 * employee ID, MSID or position the roster owns — and the audit log
 * records just what changed.
 */

const currentUser = vi.hoisted(() => ({ value: null as CurrentUser | null }));
const stored = vi.hoisted(() => ({
  profile: null as null | Record<string, unknown>,
  reads: 0,
  sets: [] as Array<Record<string, unknown>>,
  logs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => currentUser.value }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/db/client", () => {
  const tx = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        stored.sets.push(values);
        return { where: async () => {} };
      },
    }),
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        stored.logs.push(values);
      },
    }),
  };
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              stored.reads += 1;
              return stored.profile ? [stored.profile] : [];
            },
          }),
        }),
      }),
      transaction: async (run: (t: typeof tx) => Promise<void>) => run(tx),
    },
  };
});

const { updateMyProfile } = await import("./actions");
const { NO_PROFILE } = await import("@/lib/profile/panel");

const user: CurrentUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "agent@example.test",
  name: "Dana Whitfield",
  role: "agent",
  status: "active",
  employeeEid: "001895123",
  managerName: null,
};

const row = {
  id: "22222222-2222-4222-8222-222222222222",
  userId: user.id,
  employeeEid: "001895123",
  msid: "dwhitfi1",
  firstName: "Dana",
  lastName: "Whitfield",
  middleName: null,
  position: "Pharmacy Technician",
  addressLine1: "482 Meridian Ave",
  addressLine2: null,
  cityProvince: "Austin, TX",
  country: "United States",
  zipcode: "78701",
  phoneNumber: "(555) 040-2291",
  emergencyContactName: "Rosa Whitfield",
  emergencyContactNumber: "(555) 040-7734",
  emergencyContactRelationship: "Spouse",
};

const edit = { ...row, phoneNumber: "0917 040 2291", middleName: "Lee", employeeEid: "999999999", position: "Manager" };

beforeEach(() => {
  currentUser.value = null;
  stored.profile = null;
  stored.reads = 0;
  stored.sets = [];
  stored.logs = [];
});

describe("updateMyProfile", () => {
  it("refuses a signed-out caller and bad input before reading anything", async () => {
    expect(await updateMyProfile(edit)).toEqual({ ok: false, error: "Not signed in" });
    currentUser.value = user;
    expect(await updateMyProfile({ ...edit, phoneNumber: "nope" })).toMatchObject({ ok: false });
    expect(await updateMyProfile({ ...edit, firstName: "" })).toEqual({ ok: false, error: "Enter your first name." });
    expect(stored.reads).toBe(0);
    expect(stored.sets).toEqual([]);
  });

  it("tells an account with no profile row so, and writes nothing", async () => {
    currentUser.value = user;
    expect(await updateMyProfile(edit)).toEqual({ ok: false, error: NO_PROFILE });
    expect(stored.sets).toEqual([]);
  });

  it("writes only the editable columns of the caller's own row and logs what changed", async () => {
    currentUser.value = user;
    stored.profile = row;
    const result = await updateMyProfile(edit);
    expect(result).toMatchObject({ ok: true, profile: { phoneNumber: "0917 040 2291", middleName: "Lee" } });
    expect(stored.sets).toHaveLength(1);
    const set = stored.sets[0];
    expect(set).toMatchObject({ phoneNumber: "0917 040 2291", middleName: "Lee", addressLine2: null });
    expect(Object.keys(set)).not.toContain("employeeEid");
    expect(Object.keys(set)).not.toContain("position");
    expect(Object.keys(set)).not.toContain("msid");
    expect(Object.keys(set)).not.toContain("userId");
    expect(stored.logs).toHaveLength(1);
    expect(stored.logs[0]).toMatchObject({
      action: "profile.updated",
      entityId: row.id,
      before: { middleName: "", phoneNumber: "(555) 040-2291" },
      after: { middleName: "Lee", phoneNumber: "0917 040 2291" },
    });
  });

  it("is a no-op when nothing changed", async () => {
    currentUser.value = user;
    stored.profile = row;
    expect(await updateMyProfile(row)).toMatchObject({ ok: true });
    expect(stored.sets).toEqual([]);
    expect(stored.logs).toEqual([]);
  });
});
