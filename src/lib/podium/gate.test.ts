import { afterEach, describe, expect, it } from "vitest";
import type { CurrentUser } from "@/lib/auth/session";
import { podiumDueFor, podiumEnabled } from "./gate";

const user = (over: Partial<CurrentUser> = {}): CurrentUser =>
  ({
    id: "user-1",
    email: "someone@example.com",
    name: "Someone",
    role: "agent",
    status: "active",
    employeeEid: null,
    ...over,
  }) as CurrentUser;

afterEach(() => {
  delete process.env.PODIUM_INTRO;
});

describe("podiumDueFor", () => {
  it("shows the podium to a session that has not seen it", () => {
    expect(podiumDueFor(user(), undefined)).toBe(true);
  });

  it("does not show it twice in one browser session", () => {
    expect(podiumDueFor(user({ id: "user-1" }), "user-1")).toBe(false);
  });

  it("shows it again when a different account signs in on the same browser", () => {
    // Shared workstations are the ordinary case on this floor: the cookie
    // carries whose podium was shown, not merely that one was.
    expect(podiumDueFor(user({ id: "user-2" }), "user-1")).toBe(true);
  });

  it("leaves an account that is not active alone", () => {
    // They have no dashboard to be celebrated on the way to, and the shell
    // sends them to /pending before this is ever asked.
    expect(podiumDueFor(user({ status: "pending" }), undefined)).toBe(false);
  });

  it("stands down entirely when the switch is off", () => {
    process.env.PODIUM_INTRO = "off";
    expect(podiumEnabled()).toBe(false);
    expect(podiumDueFor(user(), undefined)).toBe(false);
  });

  it("is on by default, and stays on for any other value", () => {
    expect(podiumEnabled()).toBe(true);
    process.env.PODIUM_INTRO = "on";
    expect(podiumEnabled()).toBe(true);
  });

  it("tolerates the switch being set with stray whitespace", () => {
    process.env.PODIUM_INTRO = "  off  ";
    expect(podiumEnabled()).toBe(false);
  });
});
