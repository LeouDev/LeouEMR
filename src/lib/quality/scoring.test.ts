import { describe, expect, it } from "vitest";
import { QA_FORM_SEED, type QaForm } from "./forms";
import {
  COMPLIANCE_STEP,
  concatRemarks,
  findingRows,
  itemKey,
  markKeys,
  outcomeOf,
  scoreAudit,
  stepsOf,
} from "./scoring";

const form = (key: string): QaForm => {
  const found = QA_FORM_SEED.find((f) => f.key === key);
  if (!found) throw new Error(`no seed form ${key}`);
  return found;
};

const phone = form("phone").definition;
const avqa = form("avqa").definition;

describe("the seeded forms", () => {
  it("carry the workbook's totals", () => {
    expect(scoreAudit(form("phone").definition, {}).max).toBe(100);
    expect(scoreAudit(form("mpaqa").definition, {}).max).toBe(86);
    expect(scoreAudit(form("faxqa").definition, {}).max).toBe(100);
    expect(scoreAudit(avqa, {}).max).toBe(100);
  });

  it("walk one step per category with compliance last, and letter the criteria of a weighted category", () => {
    const steps = stepsOf(phone);
    expect(steps[0]).toMatchObject({ name: "Greeting", kind: "section", weight: 1 });
    expect(steps[0].items[1].label).toBe("b. Did not verify whom they're speaking to");
    expect(steps[steps.length - 1]).toMatchObject({ name: COMPLIANCE_STEP, kind: "compliance", weight: null });
    expect(steps[steps.length - 1].items).toHaveLength(4);
  });

  it("price each item of a flat-weighted group and total the group", () => {
    const drug = stepsOf(avqa).find((s) => s.name === "Drug");
    expect(drug).toMatchObject({ kind: "group", weight: 21 });
    expect(drug?.items[4]).toMatchObject({ label: "Correct backdate & route of admin", points: 1 });
  });
});

describe("scoreAudit", () => {
  it("is a full score when nothing is marked — every attribute defaults to pass", () => {
    expect(scoreAudit(phone, {})).toMatchObject({ earned: 100, max: 100, scorePct: 100, isCritical: false });
  });

  it("forfeits a weighted category's whole weight on one failed criterion, not per criterion", () => {
    const oneFail = scoreAudit(phone, { [itemKey("Member Authentication", 2)]: "fail" });
    expect(oneFail.scorePct).toBe(93);
    const twoFails = scoreAudit(phone, {
      [itemKey("Member Authentication", 2)]: "fail",
      [itemKey("Member Authentication", 0)]: "fail",
    });
    expect(twoFails.scorePct).toBe(93);
    expect(twoFails.steps.find((s) => s.name === "Member Authentication")).toMatchObject({ earned: 0, max: 7, anyFail: true });
  });

  it("deducts only the failed item's own points on a flat-weighted form", () => {
    const score = scoreAudit(avqa, { [itemKey("Drug", 4)]: "fail" });
    expect(score.earned).toBe(99);
    expect(score.scorePct).toBe(99);
    const two = scoreAudit(avqa, { [itemKey("Drug", 4)]: "fail", [itemKey("Documentation", 0)]: "fail" });
    expect(two.earned).toBe(96);
  });

  it("zeroes the score on any compliance failure, whatever else was earned", () => {
    const score = scoreAudit(phone, { [itemKey("compliance", 1)]: "fail" });
    expect(score).toMatchObject({ earned: 0, max: 100, scorePct: 0, isCritical: true });
  });

  it("ignores marks for keys the form does not have", () => {
    expect(scoreAudit(phone, { "Nonsense::0": "fail", [itemKey("Greeting", 9)]: "fail" }).scorePct).toBe(100);
    expect(markKeys(phone).has(itemKey("Greeting", 0))).toBe(true);
    expect(markKeys(phone).has(itemKey("Greeting", 9))).toBe(false);
  });
});

describe("outcomeOf", () => {
  it("reads pass at 90, monitor at 70, fail below, and auto-fail on a critical error whatever the score", () => {
    expect(outcomeOf(90, false)).toBe("pass");
    expect(outcomeOf(89.99, false)).toBe("monitor");
    expect(outcomeOf(70, false)).toBe("monitor");
    expect(outcomeOf(69.9, false)).toBe("fail");
    expect(outcomeOf(0, true)).toBe("auto-fail");
  });
});

describe("findingRows", () => {
  it("lists every attribute in form order with its mark, compliance under its own category", () => {
    // Documentation::1 is the first sub-attribute under "Agent called the Phone
    // number when multiple numbers are present", which shares that item's points.
    const rows = findingRows(form("faxqa").definition, { [itemKey("Documentation", 1)]: "fail", [itemKey("compliance", 0)]: "fail" });
    expect(rows).toHaveLength(48 + 3);
    expect(rows[0]).toMatchObject({ position: 0, category: "Provider Information", attribute: "Agent selected Incorrect Provider", result: "pass" });
    expect(rows.find((r) => r.attribute === "Agent failed to document additional PA Types")).toMatchObject({
      category: "Documentation",
      result: "fail",
    });
    expect(rows.filter((r) => r.isCompliance)).toHaveLength(3);
    expect(rows.find((r) => r.isCompliance && r.result === "fail")).toMatchObject({ category: "Compliance", attribute: "Wrong Member Selected" });
  });
});

describe("concatRemarks", () => {
  it("joins the categories that have a note, in form order, and skips blanks", () => {
    const text = concatRemarks(phone, {
      Closing: "  no survey offered ",
      Greeting: "fine",
      [COMPLIANCE_STEP]: "",
      "Not a step": "ignored",
    });
    expect(text).toBe("Greeting: fine | Closing: no survey offered");
    expect(concatRemarks(phone, {})).toBe("");
  });
});

/**
 * Sub-attributes that share their parent's points. The Fax form's guideline
 * block is nine checks worth five points between them: an audit that missed
 * three of them loses five, not fifteen.
 */
describe("attributes that share one deduction", () => {
  const form: QaForm["definition"] = {
    type: "B",
    groups: [
      {
        name: "Clinical Guidelines",
        items: [
          { label: "Answers the guideline questions", points: 5, subItems: ["Tried and failed", "Plan exclusions", "Quantity limits"] },
          { label: "Initial or reauthorization", points: 5 },
        ],
      },
    ],
    compliance: [],
  };

  const items = stepsOf(form)[0].items;
  const parent = items[0];
  const subs = items.filter((i) => i.sharesWith === parent.key);
  const sibling = items.find((i) => i.label === "Initial or reauthorization")!;

  it("walks the sub-attributes inline, each markable in its own right", () => {
    expect(items.map((i) => i.label)).toEqual([
      "Answers the guideline questions",
      "Tried and failed",
      "Plan exclusions",
      "Quantity limits",
      "Initial or reauthorization",
    ]);
    expect(subs).toHaveLength(3);
    expect(markKeys(form).size).toBe(5);
  });

  it("counts only the parents toward the total", () => {
    expect(scoreAudit(form, {}).max).toBe(10);
  });

  it("charges the parent's points once, however many sub-attributes failed", () => {
    const one = scoreAudit(form, { [subs[0].key]: "fail" });
    const all = scoreAudit(form, Object.fromEntries(subs.map((i) => [i.key, "fail"])));

    expect(one.earned).toBe(5);
    expect(all.earned).toBe(5);
    expect(one.scorePct).toBe(all.scorePct);
  });

  it("leaves a sibling attribute's points alone", () => {
    expect(scoreAudit(form, { [subs[0].key]: "fail" }).earned).toBe(5);
    expect(scoreAudit(form, { [sibling.key]: "fail" }).earned).toBe(5);
    expect(scoreAudit(form, { [subs[0].key]: "fail", [sibling.key]: "fail" }).earned).toBe(0);
  });

  it("charges nothing extra when the parent fails alongside its sub-attributes", () => {
    expect(scoreAudit(form, { [parent.key]: "fail", [subs[0].key]: "fail" }).earned).toBe(5);
  });
});

describe("the Fax QA form", () => {
  const fax = QA_FORM_SEED.find((f) => f.key === "faxqa")!;

  it("is worth the hundred points the source workbook totals", () => {
    expect(scoreAudit(fax.definition, {}).max).toBe(100);
  });

  it("deducts an attribute's own points and no more", () => {
    const drug = stepsOf(fax.definition).find((s) => s.name === "Drug Selection and Case Details")!;
    const backdate = drug.items.find((i) => i.label.includes("Backdate"))!;

    // The category is worth 25; one 3-point miss costs 3, not the category.
    expect(scoreAudit(fax.definition, { [backdate.key]: "fail" }).scorePct).toBe(97);
  });

  it("still zeroes the audit on a compliance failure", () => {
    const compliance = stepsOf(fax.definition).find((s) => s.kind === "compliance")!;
    const result = scoreAudit(fax.definition, { [compliance.items[0].key]: "fail" });

    expect(result.isCritical).toBe(true);
    expect(result.scorePct).toBe(0);
  });
});
