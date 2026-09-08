import { describe, expect, it } from "vitest";
import { matchActivity } from "./activities";

describe("a neighbouring column folded onto the same line", () => {
  it("still matches on the activity prefix, but never as exact", () => {
    const match = matchActivity("CSBO PA Edits Team Approved");
    expect(match).toMatchObject({ skillCode: "edits", exact: false });
  });

  it("prefers the longer, more specific prefix", () => {
    // "CSBO-PA-CRG-Part D" (fax) is a longer prefix than any shorter code
    // that might also technically match a leading substring.
    const match = matchActivity("CSBO PA CRG Part D Pending");
    expect(match).toMatchObject({ skillCode: "fax", exact: false });
  });

  it("does not turn a genuinely different code into a prefix match", () => {
    // Part B differs from Part D one character before the end, not by
    // trailing text — this must still go through edit distance, not prefix.
    expect(matchActivity("CSBO PA CRG Part B")).toMatchObject({ exact: false, distance: 1 });
  });
});
