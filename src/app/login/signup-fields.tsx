"use client";

export const POSITIONS = [
  "Supervisor",
  "Manager",
  "Pharmacy Technician",
  "SME",
  "CE",
  "Trainer",
] as const;

export type Position = (typeof POSITIONS)[number];

export interface SignupDetails {
  employeeEid: string;
  msid: string;
  lastName: string;
  firstName: string;
  middleName: string;
  position: Position | "";
  addressLine1: string;
  addressLine2: string;
  cityProvince: string;
  country: string;
  zipcode: string;
  phoneNumber: string;
  emergencyContactName: string;
  emergencyContactNumber: string;
  emergencyContactRelationship: string;
}

export const EMPTY_SIGNUP: SignupDetails = {
  employeeEid: "",
  msid: "",
  lastName: "",
  firstName: "",
  middleName: "",
  position: "",
  addressLine1: "",
  addressLine2: "",
  cityProvince: "",
  country: "Philippines",
  zipcode: "",
  phoneNumber: "",
  emergencyContactName: "",
  emergencyContactNumber: "",
  emergencyContactRelationship: "",
};

const field =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-navy-900 outline-none transition focus:border-navy focus:ring-2 focus:ring-navy-100";
const label = "mb-1.5 block text-sm font-medium text-navy-800";

function Text({
  name,
  title,
  value,
  onChange,
  required = false,
  placeholder,
  hint,
  type = "text",
  inputMode,
}: {
  name: keyof SignupDetails;
  title: string;
  value: string;
  onChange: (name: keyof SignupDetails, value: string) => void;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  type?: string;
  inputMode?: "text" | "numeric" | "tel";
}) {
  return (
    <label className="block">
      <span className={label}>
        {title}
        {!required && <span className="ml-1 font-normal text-muted">(optional)</span>}
      </span>
      <input
        type={type}
        inputMode={inputMode}
        required={required}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(name, e.target.value)}
        className={field}
      />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

/** The 201-file details collected at sign-up. */
export function SignupFields({
  values,
  onChange,
}: {
  values: SignupDetails;
  onChange: (name: keyof SignupDetails, value: string) => void;
}) {
  return (
    <div className="space-y-5">
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-navy-900">Identity</legend>

        <div className="grid gap-4 sm:grid-cols-2">
          <Text
            name="employeeEid"
            title="Employee ID"
            value={values.employeeEid}
            onChange={onChange}
            required
            placeholder="001895123"
            inputMode="numeric"
            hint="Digits only; keep any leading zeros."
          />
          <Text
            name="msid"
            title="MSID"
            value={values.msid}
            onChange={onChange}
            placeholder="jdelacruz1"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Text name="lastName" title="Last name" value={values.lastName} onChange={onChange} required />
          <Text name="firstName" title="First name" value={values.firstName} onChange={onChange} required />
          <Text name="middleName" title="Middle name" value={values.middleName} onChange={onChange} />
        </div>

        <label className="block">
          <span className={label}>Position</span>
          <select
            required
            value={values.position}
            onChange={(e) => onChange("position", e.target.value)}
            className={field}
          >
            <option value="">Select a position…</option>
            {POSITIONS.map((position) => (
              <option key={position} value={position}>
                {position}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-navy-900">Address</legend>
        <Text name="addressLine1" title="Address line 1" value={values.addressLine1} onChange={onChange} />
        <Text name="addressLine2" title="Address line 2" value={values.addressLine2} onChange={onChange} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Text name="cityProvince" title="City / province" value={values.cityProvince} onChange={onChange} />
          <Text name="country" title="Country" value={values.country} onChange={onChange} />
          <Text name="zipcode" title="Zipcode" value={values.zipcode} onChange={onChange} inputMode="numeric" />
        </div>
        <Text
          name="phoneNumber"
          title="Phone number"
          value={values.phoneNumber}
          onChange={onChange}
          type="tel"
          inputMode="tel"
        />
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-navy-900">Emergency contact</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Text name="emergencyContactName" title="Name" value={values.emergencyContactName} onChange={onChange} />
          <Text
            name="emergencyContactRelationship"
            title="Relationship"
            value={values.emergencyContactRelationship}
            onChange={onChange}
          />
          <Text
            name="emergencyContactNumber"
            title="Contact number"
            value={values.emergencyContactNumber}
            onChange={onChange}
            type="tel"
            inputMode="tel"
          />
        </div>
      </fieldset>
    </div>
  );
}
