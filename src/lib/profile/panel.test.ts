import { describe, expect, it } from "vitest";
import { changedFields, formFromProfile, initialsOf, validateProfileForm, EMPTY_PROFILE_FORM } from "./panel";

const valid = {
  ...EMPTY_PROFILE_FORM,
  firstName: " Dana ",
  lastName: "Whitfield",
  phoneNumber: "+63 (917) 040-2291",
  zipcode: "78701",
  emergencyContactNumber: "0917 040 7734",
};

describe("validateProfileForm", () => {
  it("trims every field and accepts the shapes people actually type", () => {
    const result = validateProfileForm(valid);
    expect(result).toMatchObject({ ok: true, value: { firstName: "Dana", phoneNumber: "+63 (917) 040-2291" } });
  });

  it("requires both names", () => {
    expect(validateProfileForm({ ...valid, firstName: "  " })).toEqual({ ok: false, error: "Enter your first name." });
    expect(validateProfileForm({ ...valid, lastName: "" })).toEqual({ ok: false, error: "Enter your last name." });
  });

  it("checks the phone numbers and the zipcode only when they are given", () => {
    expect(validateProfileForm({ ...valid, phoneNumber: "", zipcode: "", emergencyContactNumber: "" }).ok).toBe(true);
    expect(validateProfileForm({ ...valid, phoneNumber: "12345" }).ok).toBe(false);
    expect(validateProfileForm({ ...valid, phoneNumber: "call me" }).ok).toBe(false);
    expect(validateProfileForm({ ...valid, phoneNumber: "1234567890123456" }).ok).toBe(false);
    expect(validateProfileForm({ ...valid, emergencyContactNumber: "x" })).toMatchObject({ ok: false });
    expect(validateProfileForm({ ...valid, zipcode: "1" }).ok).toBe(false);
    expect(validateProfileForm({ ...valid, zipcode: "SW1A 1AA" }).ok).toBe(true);
  });

  it("refuses an oversized field", () => {
    expect(validateProfileForm({ ...valid, addressLine1: "x".repeat(201) })).toEqual({
      ok: false,
      error: "Keep each field under 200 characters.",
    });
  });
});

describe("the form and the row", () => {
  it("reads null columns as blank and lists only what a save changes", () => {
    const form = formFromProfile({ firstName: "Dana", lastName: "Whitfield", middleName: null, phoneNumber: null });
    expect(form.middleName).toBe("");
    expect(form.firstName).toBe("Dana");
    expect(formFromProfile(null)).toEqual(EMPTY_PROFILE_FORM);
    expect(changedFields(form, { ...form, phoneNumber: "0917", country: "" })).toEqual(["phoneNumber"]);
  });

  it("makes initials from the first two words", () => {
    expect(initialsOf("Dana Whitfield")).toBe("DW");
    expect(initialsOf("  cher ")).toBe("C");
    expect(initialsOf("Dela Cruz, José")).toBe("DC");
    expect(initialsOf("")).toBe("?");
  });
});
