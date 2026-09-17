import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QA_FORM_SEED } from "@/lib/quality/forms";
import { stepsOf, type QaStep } from "@/lib/quality/scoring";
import { CriterionRow } from "./audit-form";

/**
 * How a shared attribute reads is invisible to every test of the scorer: the
 * points are right either way, and only the row says so. It was briefly
 * rendered as "· 0 pts" — the opposite of the truth for a check that can
 * cost five.
 */
const fax = QA_FORM_SEED.find((form) => form.key === "faxqa")!;

function renderStep(step: QaStep, fail: string[] = []): string {
  return renderToStaticMarkup(
    createElement(
      "ul",
      null,
      step.items.map((item) =>
        createElement(CriterionRow, {
          key: item.key,
          item,
          sharedPoints: item.sharesWith
            ? (step.items.find((other) => other.key === item.sharesWith)?.points ?? null)
            : null,
          value: fail.includes(item.key) ? "fail" : "pass",
          isCompliance: step.kind === "compliance",
          onMark: () => {},
        }),
      ),
    ),
  );
}

/** One line per row: its label and the points note, indent marked. */
function lines(html: string): string[] {
  return html.split("<li").slice(1).map((li) => {
    const attributes = li.slice(0, li.indexOf(">"));
    const body = li.slice(li.indexOf(">") + 1);
    // Everything the row says, minus the two buttons that close it.
    const text = body.replace(/<[^>]+>/g, "").replace(/PassFail$/, "").trim();
    return `${attributes.includes("pl-6") ? "  " : ""}${text}`;
  });
}

describe("a criterion row on the Fax form's shared guideline block", () => {
  const step = stepsOf(fax.definition).find((s) => s.name === "Clinical Guidelines")!;

  it("shows the parent's own points, and says what each sub-attribute shares", () => {
    expect(lines(renderStep(step))).toEqual([
      "Agent choose other/not known/not Provided when information is provided · 5 pts",
      "  Agent adds information provided · shares 5 pts",
      "  Agent entered IntialvsReauthorization · shares 5 pts",
      "  Agent answered Plan Exclusion questions · shares 5 pts",
      "  Agent answered Formulary Speci · shares 5 pts",
      "  Agent answered Quantity limits question correctly · shares 5 pts",
      "  Agent answered Diagnosis Question · shares 5 pts",
      "  Agent failed to make OBC to MDO · shares 5 pts",
      "  Agent failed to do corret calculation · shares 5 pts",
      "  Agent failed to enter appropriate edits · shares 5 pts",
      "  Agent allows the System driven decision · shares 5 pts",
      "  Agent does not manipulate answers to force pend the case without specific direction · shares 5 pts",
      "Tried and Failed medications · 5 pts",
    ]);
  });

  it("never reads 0 pts, which would say the opposite of what the check costs", () => {
    expect(renderStep(step)).not.toContain("0 pts");
  });

  it("sets the sub-attributes in and leaves the two scored attributes flush", () => {
    const indented = lines(renderStep(step)).filter((line) => line.startsWith("  "));
    expect(indented).toHaveLength(11);
  });
});

describe("a criterion row elsewhere on the form", () => {
  it("shows an ordinary attribute's own points, with no shared note", () => {
    const drug = stepsOf(fax.definition).find((s) => s.name === "Drug Selection and Case Details")!;
    const flush = lines(renderStep(drug)).filter((line) => !line.startsWith("  "));

    expect(flush[0]).toBe("Agent selected Correct Drug · 4 pts");
    // A scored attribute carries its own points and says nothing about sharing;
    // only the rows set in beneath one do.
    expect(flush.some((line) => line.includes("shares"))).toBe(false);
    expect(flush).toEqual(flush.filter((line) => / · \d+ pts$/.test(line)));
  });

  it("warns on a failed compliance item, which zeroes the audit", () => {
    const compliance = stepsOf(fax.definition).find((s) => s.kind === "compliance")!;
    const html = renderStep(compliance, [compliance.items[0].key]);

    expect(html).toContain("score → 0");
    expect(lines(html)[1]).not.toContain("score → 0");
  });
});
