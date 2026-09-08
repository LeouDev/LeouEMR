import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/auth/session";

/**
 * An agent must never reach `/skills`.
 *
 * Its three siblings on the same nav group (MBO, EWS, Ramp) all redirect an
 * agent away before querying anything; this page didn't, so an agent could
 * open the skill-target/rating-curve reference table directly by URL even
 * though the nav deliberately gives them "My Tools" instead. The database
 * mock throws on any access, so this also proves the redirect happens
 * before the page ever queries skill_references — not just that it
 * eventually renders something an agent shouldn't see.
 */

const currentUser = vi.hoisted(() => ({ value: null as CurrentUser | null }));

class Redirected extends Error {
  constructor(public to: string) {
    super(`redirect:${to}`);
  }
}

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => currentUser.value }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
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

const SkillsPage = (await import("./page")).default;

beforeEach(() => {
  currentUser.value = {
    id: "11111111-1111-4111-8111-111111111111",
    email: "agent@example.test",
    name: "Test Agent",
    role: "agent",
    status: "active",
    employeeEid: "001895123",
    managerName: null,
  };
});

describe("/skills", () => {
  it("redirects an agent to /dashboard without touching the database", async () => {
    const failure = await SkillsPage().then(
      () => null,
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(Redirected);
    expect((failure as Redirected).to).toBe("/dashboard");
  });
});
