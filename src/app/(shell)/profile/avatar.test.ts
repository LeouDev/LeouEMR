import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/auth/session";

/**
 * Profile pictures: only the signed-in person's own row is ever written
 * or served, a bad or oversized upload is refused before the database is
 * touched, and the audit log never carries the bytes.
 */

const currentUser = vi.hoisted(() => ({ value: null as CurrentUser | null }));
const stored = vi.hoisted(() => ({
  row: null as null | { contentType: string; image: string },
  upserts: [] as Array<Record<string, unknown>>,
  deletes: 0,
  logs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => currentUser.value }));
vi.mock("@/lib/db/client", () => {
  const tx = {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        const upsert = {
          onConflictDoUpdate: async () => {
            stored.upserts.push(values);
          },
        };
        // The audit log insert is awaited directly; the avatar insert chains on.
        const p = Promise.resolve().then(() => {
          if (!("image" in values)) stored.logs.push(values);
        });
        return Object.assign(p, upsert);
      },
    }),
    delete: () => ({
      where: async () => {
        stored.deletes += 1;
      },
    }),
  };
  return {
    db: {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => (stored.row ? [stored.row] : []) }) }) }),
      transaction: async (run: (t: typeof tx) => Promise<void>) => run(tx),
    },
  };
});

const { removeMyAvatar, updateMyAvatar } = await import("./actions");
const { GET } = await import("./avatar/route");
const { AVATAR_NOT_AN_IMAGE, AVATAR_TOO_LARGE, MAX_AVATAR_BYTES } = await import("@/lib/profile/avatar");

const user: CurrentUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "agent@example.test",
  name: "Dana Whitfield",
  role: "agent",
  status: "active",
  employeeEid: "001895123",
  managerName: null,
};
const png = `data:image/png;base64,${Buffer.alloc(1200, 7).toString("base64")}`;

beforeEach(() => {
  currentUser.value = null;
  stored.row = null;
  stored.upserts = [];
  stored.deletes = 0;
  stored.logs = [];
});

describe("updateMyAvatar", () => {
  it("refuses a signed-out caller, a non-image and an oversized upload before writing", async () => {
    expect(await updateMyAvatar({ image: png })).toEqual({ ok: false, error: "Not signed in" });
    currentUser.value = user;
    expect(await updateMyAvatar({ image: "data:image/svg+xml;base64,PHN2Zz4=" })).toEqual({ ok: false, error: AVATAR_NOT_AN_IMAGE });
    expect(await updateMyAvatar({ image: `data:image/png;base64,${"A".repeat(MAX_AVATAR_BYTES * 2)}` })).toEqual({
      ok: false,
      error: AVATAR_TOO_LARGE,
    });
    expect(await updateMyAvatar("nope")).toEqual({ ok: false, error: AVATAR_NOT_AN_IMAGE });
    expect(stored.upserts).toEqual([]);
  });

  it("upserts the caller's own row and logs the change without the bytes", async () => {
    currentUser.value = user;
    const result = await updateMyAvatar({ image: png });
    expect(result).toMatchObject({ ok: true });
    expect(stored.upserts).toHaveLength(1);
    expect(stored.upserts[0]).toMatchObject({ userId: user.id, contentType: "image/png" });
    expect(stored.logs).toHaveLength(1);
    expect(stored.logs[0]).toMatchObject({ action: "avatar.updated", entityId: user.id, after: { contentType: "image/png", bytes: 1200 } });
    expect(JSON.stringify(stored.logs[0])).not.toContain(Buffer.alloc(1200, 7).toString("base64").slice(0, 40));
  });
});

describe("removeMyAvatar", () => {
  it("deletes the caller's own row", async () => {
    expect(await removeMyAvatar()).toEqual({ ok: false, error: "Not signed in" });
    currentUser.value = user;
    expect(await removeMyAvatar()).toEqual({ ok: true, version: null });
    expect(stored.deletes).toBe(1);
    expect(stored.logs[0]).toMatchObject({ action: "avatar.removed" });
  });
});

describe("the avatar route", () => {
  it("serves the caller's picture with a long cache, and nothing to anyone else", async () => {
    expect((await GET()).status).toBe(403);
    currentUser.value = user;
    expect((await GET()).status).toBe(404);
    stored.row = { contentType: "image/webp", image: Buffer.from("hello").toString("base64") };
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(response.headers.get("Cache-Control")).toContain("immutable");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("hello");
  });
});
