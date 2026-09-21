import { describe, expect, it } from "vitest";
import { CLOSED, parseView, toggled } from "./roster-view";

describe("parseView", () => {
  it("reads back the three levels that were open", () => {
    const raw = JSON.stringify({ managers: ["Cruz"], leads: ["Sacurom"], agents: ["emp-1"] });
    expect(parseView(raw)).toEqual({ managers: ["Cruz"], leads: ["Sacurom"], agents: ["emp-1"] });
  });

  it("opens nothing when there is nothing saved", () => {
    expect(parseView(null)).toEqual(CLOSED);
    expect(parseView("")).toEqual(CLOSED);
  });

  it("opens nothing rather than throwing on a value it does not recognise", () => {
    // A half-written value, or a shape from an older build. This runs on
    // every render of the roster; it must not be able to fail the page.
    expect(parseView("{not json")).toEqual(CLOSED);
    expect(parseView("null")).toEqual(CLOSED);
    expect(parseView('"a string"')).toEqual(CLOSED);
    expect(parseView("[]")).toEqual(CLOSED);
  });

  it("keeps only the names, dropping anything else that was in the list", () => {
    const raw = JSON.stringify({ managers: ["Cruz", 7, null, { name: "x" }], leads: "nope" });
    expect(parseView(raw)).toEqual({ managers: ["Cruz"], leads: [], agents: [] });
  });
});

describe("toggled", () => {
  it("opens a row that was closed and closes one that was open", () => {
    expect(toggled([], "a")).toEqual(["a"]);
    expect(toggled(["a"], "a")).toEqual([]);
  });

  it("leaves the other rows where they were", () => {
    expect(toggled(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(toggled(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("does not mutate what it was given", () => {
    const open = ["a"];
    toggled(open, "b");
    expect(open).toEqual(["a"]);
  });
});
