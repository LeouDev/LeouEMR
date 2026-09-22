import { describe, expect, it } from "vitest";
import type { CurrentUser } from "./session";
import { applyViewAs, canSwitchView, encodeViewAs, parseViewAs } from "./view-as";

const admin: CurrentUser = {
  id: "u1",
  email: "owner@example.test",
  name: "Leou Comendador",
  role: "admin",
  status: "active",
  employeeEid: null,
  managerName: null,
};

describe("view as a manager", () => {
  it("round-trips the cookie and rejects anything else", () => {
    expect(parseViewAs(encodeViewAs({ role: "manager", managerName: "Comendador" }))).toEqual({ role: "manager", managerName: "Comendador" });
    expect(parseViewAs("manager:")).toBeNull();
    expect(parseViewAs("admin:x")).toBeNull();
    expect(parseViewAs(undefined)).toBeNull();
  });

  it("turns an administrator into the chosen manager, remembering what they really are", () => {
    const viewed = applyViewAs(admin, "manager:Comendador");
    expect(viewed.role).toBe("manager");
    expect(viewed.managerName).toBe("Comendador");
    expect(viewed.actualRole).toBe("admin");
    expect(canSwitchView(viewed)).toBe(true);
  });

  it("never widens: anyone else keeps their own role whatever the cookie says", () => {
    const manager: CurrentUser = { ...admin, role: "manager", managerName: "Cruz" };
    expect(applyViewAs(manager, "manager:Comendador")).toBe(manager);
    const agent: CurrentUser = { ...admin, role: "agent", employeeEid: "1" };
    expect(applyViewAs(agent, "manager:Comendador")).toBe(agent);
    expect(canSwitchView(manager)).toBe(false);
  });

  it("leaves an administrator alone without a cookie", () => {
    expect(applyViewAs(admin, undefined)).toBe(admin);
    expect(canSwitchView(admin)).toBe(true);
  });
});
