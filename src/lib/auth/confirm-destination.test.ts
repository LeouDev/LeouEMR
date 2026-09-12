import { describe, expect, it } from "vitest";
import { confirmDestination } from "./confirm-destination";

describe("confirmDestination", () => {
  it("sends a password reset to the new-password page and everything else to pending", () => {
    expect(confirmDestination("recovery")).toBe("/reset-password");
    expect(confirmDestination("signup")).toBe("/pending");
    expect(confirmDestination("email_change")).toBe("/pending");
  });
});
