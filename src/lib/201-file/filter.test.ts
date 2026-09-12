import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  PAGE_SIZE,
  displayName,
  filterPersonnel,
  filtersActive,
  formatAddress,
  personnelFacets,
  type PersonnelProfile,
  type PersonnelRow,
} from "./filter";

function profile(overrides: Partial<PersonnelProfile> = {}): PersonnelProfile {
  return {
    employeeEid: "001",
    msid: null,
    lastName: "Reyes",
    firstName: "Kristian",
    middleName: null,
    position: "Pharmacy Technician",
    addressLine1: null,
    addressLine2: null,
    cityProvince: null,
    country: null,
    zipcode: null,
    phoneNumber: null,
    emergencyContactName: null,
    emergencyContactNumber: null,
    emergencyContactRelationship: null,
    ...overrides,
  };
}

function row(overrides: Partial<PersonnelRow> = {}): PersonnelRow {
  return {
    id: "r1",
    eid: "001",
    name: "REYES, KRISTIAN",
    site: "Cebu",
    supervisorName: "Lopez, Ana",
    managerName: "Cruz, Ben",
    standing: "active",
    email: "kristian.reyes@example.test",
    profile: profile(),
    ...overrides,
  };
}

const REGISTERED = row();
const UNREGISTERED = row({ id: "r2", eid: "002", name: "SANTOS, MARIA", email: null, profile: null });
const OTHER_TEAM = row({
  id: "r3",
  eid: "003",
  name: "DELA CRUZ, JOSÉ",
  site: "Davao",
  supervisorName: "Tan, Bea",
  standing: "separated",
  email: "jose.delacruz@example.test",
  profile: profile({ employeeEid: "003", lastName: "Dela Cruz", firstName: "José", middleName: "Ramon", msid: "jdelacru" }),
});
const ROWS = [REGISTERED, UNREGISTERED, OTHER_TEAM];

describe("filterPersonnel", () => {
  it("opens on the registered records only, as the page always did", () => {
    expect(filterPersonnel(ROWS, DEFAULT_FILTERS).map((r) => r.id)).toEqual(["r1", "r3"]);
  });

  it("can show the people who have not signed up, or everyone", () => {
    expect(filterPersonnel(ROWS, { ...DEFAULT_FILTERS, registration: "unregistered" }).map((r) => r.id)).toEqual([
      "r2",
    ]);
    expect(filterPersonnel(ROWS, { ...DEFAULT_FILTERS, registration: "all" })).toHaveLength(3);
  });

  it("narrows by team leader, site and standing", () => {
    const all = { ...DEFAULT_FILTERS, registration: "all" as const };
    expect(filterPersonnel(ROWS, { ...all, supervisor: "Tan, Bea" }).map((r) => r.id)).toEqual(["r3"]);
    expect(filterPersonnel(ROWS, { ...all, site: "Cebu" }).map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(filterPersonnel(ROWS, { ...all, standing: "separated" }).map((r) => r.id)).toEqual(["r3"]);
  });

  it("finds a person by either spelling of their name, in any case", () => {
    const all = { ...DEFAULT_FILTERS, registration: "all" as const };
    expect(filterPersonnel(ROWS, { ...all, query: "reyes kristian" }).map((r) => r.id)).toEqual(["r1"]);
    expect(filterPersonnel(ROWS, { ...all, query: "Kristian, Reyes" }).map((r) => r.id)).toEqual(["r1"]);
    expect(filterPersonnel(ROWS, { ...all, query: "santos" }).map((r) => r.id)).toEqual(["r2"]);
  });

  it("ignores accents, and matches employee ID, MSID and email", () => {
    const all = { ...DEFAULT_FILTERS, registration: "all" as const };
    expect(filterPersonnel(ROWS, { ...all, query: "jose" }).map((r) => r.id)).toEqual(["r3"]);
    expect(filterPersonnel(ROWS, { ...all, query: "002" }).map((r) => r.id)).toEqual(["r2"]);
    expect(filterPersonnel(ROWS, { ...all, query: "jdelacru" }).map((r) => r.id)).toEqual(["r3"]);
    expect(filterPersonnel(ROWS, { ...all, query: "kristian.reyes@" }).map((r) => r.id)).toEqual(["r1"]);
  });

  it("requires every term, so a longer query narrows rather than widens", () => {
    const all = { ...DEFAULT_FILTERS, registration: "all" as const };
    expect(filterPersonnel(ROWS, { ...all, query: "cruz cebu" })).toEqual([]);
    expect(filterPersonnel(ROWS, { ...all, query: "   " })).toHaveLength(3);
  });
});

describe("personnelFacets", () => {
  it("lists each team leader and site once, sorted, skipping blanks", () => {
    expect(personnelFacets([...ROWS, row({ id: "r4", site: null, supervisorName: null })])).toEqual({
      supervisors: ["Lopez, Ana", "Tan, Bea"],
      sites: ["Cebu", "Davao"],
    });
  });
});

describe("display helpers", () => {
  it("names a registered person from their profile and an unregistered one from the roster", () => {
    expect(displayName(REGISTERED)).toBe("Reyes, Kristian");
    expect(displayName(OTHER_TEAM)).toBe("Dela Cruz, José R.");
    expect(displayName(UNREGISTERED)).toBe("SANTOS, MARIA");
  });

  it("joins only the address parts that were given", () => {
    expect(formatAddress(profile({ addressLine1: "12 Rizal St", cityProvince: "Cebu City", zipcode: "6000" }))).toBe(
      "12 Rizal St, Cebu City, 6000",
    );
    expect(formatAddress(profile())).toBe("");
  });

  it("knows when the reader has changed anything from the opening view", () => {
    expect(filtersActive(DEFAULT_FILTERS)).toBe(false);
    expect(filtersActive({ ...DEFAULT_FILTERS, query: "a" })).toBe(true);
    expect(filtersActive({ ...DEFAULT_FILTERS, registration: "all" })).toBe(true);
    expect(PAGE_SIZE).toBe(20);
  });
});
