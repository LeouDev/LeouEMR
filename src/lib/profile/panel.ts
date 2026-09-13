/**
 * The profile panel behind the name in the header: what a person may edit
 * about their own personnel record, and the checks it passes before it is
 * saved. Employee ID and position are the roster's, and the team leader
 * and manager come from the import — none of those are edited here.
 */

export interface ProfileForm {
  firstName: string;
  lastName: string;
  middleName: string;
  phoneNumber: string;
  addressLine1: string;
  addressLine2: string;
  cityProvince: string;
  country: string;
  zipcode: string;
  emergencyContactName: string;
  emergencyContactNumber: string;
  emergencyContactRelationship: string;
}

export const PROFILE_FIELDS = [
  "firstName",
  "lastName",
  "middleName",
  "phoneNumber",
  "addressLine1",
  "addressLine2",
  "cityProvince",
  "country",
  "zipcode",
  "emergencyContactName",
  "emergencyContactNumber",
  "emergencyContactRelationship",
] as const satisfies ReadonlyArray<keyof ProfileForm>;

export const EMPTY_PROFILE_FORM: ProfileForm = {
  firstName: "",
  lastName: "",
  middleName: "",
  phoneNumber: "",
  addressLine1: "",
  addressLine2: "",
  cityProvince: "",
  country: "",
  zipcode: "",
  emergencyContactName: "",
  emergencyContactNumber: "",
  emergencyContactRelationship: "",
};

export const NO_PROFILE = "No personnel profile is on file for this account — it is captured at sign-up.";
export const MAX_FIELD = 200;

/** The form as the stored row fills it: every column a string, null as blank. */
export function formFromProfile(profile: Partial<Record<keyof ProfileForm, string | null>> | null): ProfileForm {
  const form = { ...EMPTY_PROFILE_FORM };
  if (!profile) return form;
  for (const key of PROFILE_FIELDS) form[key] = profile[key] ?? "";
  return form;
}

/** 7 to 15 digits, with the spaces, dashes, dots, brackets and leading + people type around them. */
function isPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "").length;
  return /^\+?[\d\s().-]+$/.test(value) && digits >= 7 && digits <= 15;
}

/** 3 to 10 letters, digits, spaces or dashes — Philippine codes are four digits, but the roster has people abroad. */
function isZipcode(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9 -]{2,9}$/.test(value);
}

export type ProfileCheck = { ok: true; value: ProfileForm } | { ok: false; error: string };

/**
 * The same checks on the page and in the action, so a refusal reads the
 * same wherever it is met. Names are required; everything else may be
 * blank, and what is given has to look like what it claims to be.
 */
export function validateProfileForm(input: ProfileForm): ProfileCheck {
  const value = { ...EMPTY_PROFILE_FORM };
  for (const key of PROFILE_FIELDS) {
    const text = (input[key] ?? "").trim();
    if (text.length > MAX_FIELD) return { ok: false, error: `Keep each field under ${MAX_FIELD} characters.` };
    value[key] = text;
  }
  if (!value.firstName) return { ok: false, error: "Enter your first name." };
  if (!value.lastName) return { ok: false, error: "Enter your last name." };
  if (value.phoneNumber && !isPhone(value.phoneNumber)) {
    return { ok: false, error: "Enter a phone number with 7 to 15 digits — spaces, dashes and a leading + are fine." };
  }
  if (value.emergencyContactNumber && !isPhone(value.emergencyContactNumber)) {
    return { ok: false, error: "Enter the emergency contact's phone number with 7 to 15 digits." };
  }
  if (value.zipcode && !isZipcode(value.zipcode)) {
    return { ok: false, error: "Enter a zipcode of 3 to 10 letters or digits." };
  }
  return { ok: true, value };
}

/** Which fields a save actually changes — the audit log records only those. */
export function changedFields(before: ProfileForm, after: ProfileForm): Array<keyof ProfileForm> {
  return PROFILE_FIELDS.filter((key) => before[key] !== after[key]);
}

/** "DW" for Dana Whitfield; one letter for a single name; "?" for none. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}
