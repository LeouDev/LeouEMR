import { describe, expect, it } from "vitest";
import { groupSkillFacts } from "./skill-breakdown";

/**
 * The employee page's skill breakdown, one row per configured skill.
 *
 * The facts carry whatever label the source file used that week, and the
 * same skill is not always written the same way from one file to the next.
 */

const FAX = { code: "FAX", name: "Fax" };
const PHONES = { code: "PARTD_PHONES", name: "PartD_Phones" };
const resolve = (label: string) =>
  ({ fax: FAX, "fax ": FAX, "fax case": FAX, partd_phones: PHONES })[label.toLowerCase()];

const WEEKS = ["2026-04-25", "2026-05-02"];
const fact = (skillLabel: string, factDate: string, cases: number, hours: number) => ({
  skillLabel,
  factDate,
  cases,
  hours,
  prodWeight: hours,
});

describe("groupSkillFacts", () => {
  it("folds every spelling of a skill into one row, week by week", () => {
    const rows = groupSkillFacts(
      [
        fact("Fax", "2026-04-27", 98, 16.1),
        fact("FAX ", "2026-05-04", 113, 13.5),
        fact("Fax Case", "2026-05-05", 7, 1),
      ],
      WEEKS,
      resolve,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].ref).toBe(FAX);
    expect([...rows[0].weeks.entries()]).toEqual([
      ["2026-04-25", { cases: 98, hours: 16.1, prodWeight: 16.1 }],
      ["2026-05-02", { cases: 120, hours: 14.5, prodWeight: 14.5 }],
    ]);
  });

  it("keeps different skills apart", () => {
    const rows = groupSkillFacts(
      [fact("Fax", "2026-04-27", 10, 2), fact("PartD_Phones", "2026-04-27", 5, 1)],
      WEEKS,
      resolve,
    );
    expect(rows.map((r) => r.ref.code).sort()).toEqual(["FAX", "PARTD_PHONES"]);
  });

  it("leaves out a label no configured skill answers to, and a day outside the weeks shown", () => {
    const rows = groupSkillFacts(
      [fact("Mystery", "2026-04-27", 10, 2), fact("Fax", "2026-06-01", 10, 2)],
      WEEKS,
      resolve,
    );
    expect(rows).toEqual([]);
  });
});
