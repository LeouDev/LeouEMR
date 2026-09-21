import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, UserRole } from "@/lib/auth/session";

/**
 * Every board write is gated on role before anything is read: an agent is
 * refused, and so is anyone signed out or still pending. The database mock
 * throws on any use, so reaching it proves the gate passed — and the input
 * checks that follow the gate are pinned here too, since they are the only
 * thing between a stray form and a row.
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

const { addItem, deleteItem, editItem, saveDay, saveNote, toggleItem } = await import("./actions");

function signedInAs(role: UserRole): CurrentUser {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: `${role}@example.test`,
    name: `Test ${role}`,
    role,
    status: "active",
    employeeEid: null,
    managerName: null,
  };
}

const ITEM = "44444444-4444-4444-8444-444444444444";
const REFUSED = { ok: false, error: "My Space is for team leaders, managers and the support roles" };

beforeEach(() => {
  currentUser.value = null;
});

describe("who may write to a board", () => {
  it("refuses an agent on every action", async () => {
    currentUser.value = signedInAs("agent");
    expect(await addItem({ box: "todos", text: "x" })).toEqual(REFUSED);
    expect(await toggleItem({ id: ITEM })).toEqual(REFUSED);
    expect(await editItem({ id: ITEM, text: "x" })).toEqual(REFUSED);
    expect(await deleteItem({ id: ITEM })).toEqual(REFUSED);
    expect(await saveDay()).toEqual(REFUSED);
    expect(await saveNote({ text: "x" })).toEqual(REFUSED);
  });

  it("refuses a signed-out or pending caller", async () => {
    expect(await addItem({ box: "todos", text: "x" })).toEqual({ ok: false, error: "Not signed in" });
    currentUser.value = { ...signedInAs("supervisor"), status: "pending" };
    expect(await saveDay()).toEqual({ ok: false, error: "Not signed in" });
    expect(await saveNote({ text: "x" })).toEqual({ ok: false, error: "Not signed in" });
  });

  it.each(["supervisor", "manager", "trainer", "sme", "admin"] as UserRole[])("lets a %s through to the board", async (role) => {
    currentUser.value = signedInAs(role);
    await expect(addItem({ box: "todos", text: "x" })).rejects.toThrow("database reached before the authorization check");
  });
});

describe("what an item may hold", () => {
  beforeEach(() => {
    currentUser.value = signedInAs("supervisor");
  });

  it("refuses an empty or whitespace-only text before touching the database", async () => {
    expect(await addItem({ box: "ideas", text: "   " })).toEqual({ ok: false, error: "Write something first" });
    expect(await editItem({ id: ITEM, text: "" })).toEqual({ ok: false, error: "Write something first" });
  });

  it("refuses a box that is not one of the four", async () => {
    const result = await addItem({ box: "wishes", text: "x" });
    expect(result.ok).toBe(false);
  });

  it("caps the text and the note", async () => {
    expect(await addItem({ box: "todos", text: "x".repeat(501) })).toEqual({ ok: false, error: "Keep it under 500 characters" });
    expect(await addItem({ box: "todos", text: "x", note: "n".repeat(301) })).toEqual({
      ok: false,
      error: "Keep the note under 300 characters",
    });
  });

  it("refuses an id that is not a uuid", async () => {
    expect((await toggleItem({ id: "nope" })).ok).toBe(false);
    expect((await deleteItem({ id: 12 })).ok).toBe(false);
  });
});

describe("what the notepad may hold", () => {
  beforeEach(() => {
    currentUser.value = signedInAs("supervisor");
  });

  it("caps the page, so a stuck key cannot grow the database", () => {
    // Checked before the database is touched: the mock throws on any use,
    // so an error rather than a throw is the proof.
    return expect(saveNote({ text: "x".repeat(10_001) })).resolves.toEqual({
      ok: false,
      error: "Keep the notepad under 10000 characters",
    });
  });

  it("refuses anything that is not text at all", async () => {
    expect((await saveNote({ text: 12 })).ok).toBe(false);
    expect((await saveNote({})).ok).toBe(false);
    expect((await saveNote(null)).ok).toBe(false);
  });

  it("does not trim what was written", async () => {
    // A notepad's indentation and blank lines are the writer's, so the
    // schema must not strip them — unlike an item's text, which is trimmed.
    // Reaching the database is what proves the value passed validation.
    await expect(saveNote({ text: "   \n  indented  \n" })).rejects.toThrow(
      "database reached before the authorization check",
    );
    // And an empty pad is a legitimate state: clearing it must be allowed.
    await expect(saveNote({ text: "" })).rejects.toThrow(
      "database reached before the authorization check",
    );
  });
});
