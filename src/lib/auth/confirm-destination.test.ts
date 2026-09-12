import { describe, expect, it } from "vitest";
import { confirmDestination, isConfirmType } from "./confirm-destination";

describe("confirmDestination", () => {
  it("sends a password reset to the new-password page and everything else to pending", () => {
    expect(confirmDestination("recovery")).toBe("/reset-password");
    expect(confirmDestination("signup")).toBe("/pending");
    expect(confirmDestination("email_change")).toBe("/pending");
  });
});

describe("isConfirmType", () => {
  it("accepts the link types Supabase issues and nothing else", () => {
    expect(isConfirmType("signup")).toBe(true);
    expect(isConfirmType("recovery")).toBe(true);
    expect(isConfirmType("anything")).toBe(false);
    expect(isConfirmType(null)).toBe(false);
  });
});
