import { describe, expect, it } from "vitest";
import { BOXES } from "./board";
import { PAD_CARD, parseCollapsed, toggled, type CardKey } from "./card-view";

describe("parseCollapsed", () => {
  it("reads back the cards that were folded", () => {
    expect(parseCollapsed(JSON.stringify(["letgo", "pad"]))).toEqual(["letgo", "pad"]);
  });

  it("folds nothing when there is nothing saved", () => {
    // The board as it was before any of this existed.
    expect(parseCollapsed(null)).toEqual([]);
    expect(parseCollapsed("")).toEqual([]);
  });

  it("folds nothing rather than throwing on a value it does not recognise", () => {
    // This runs on every render of every card; it must not be able to fail
    // the page.
    expect(parseCollapsed("{not json")).toEqual([]);
    expect(parseCollapsed("null")).toEqual([]);
    expect(parseCollapsed('"letgo"')).toEqual([]);
    expect(parseCollapsed("{}")).toEqual([]);
  });

  it("drops keys for cards that do not exist", () => {
    // A key from an older build, or a card since renamed, must not fold
    // something else or survive into the saved list.
    expect(parseCollapsed(JSON.stringify(["letgo", "wishes", 7, null]))).toEqual(["letgo"]);
  });

  it("accepts every card the page actually has", () => {
    const every = [...BOXES, PAD_CARD];
    expect(parseCollapsed(JSON.stringify(every))).toEqual(every);
  });
});

describe("toggled", () => {
  it("folds a card that was open and opens one that was folded", () => {
    expect(toggled([], "todos")).toEqual(["todos"]);
    expect(toggled(["todos"], "todos")).toEqual([]);
  });

  it("leaves the other cards as they were", () => {
    expect(toggled(["todos", "ideas"], PAD_CARD)).toEqual(["todos", "ideas", "pad"]);
    expect(toggled(["todos", "ideas", "pad"], "ideas")).toEqual(["todos", "pad"]);
  });

  it("does not mutate what it was given", () => {
    const collapsed: CardKey[] = ["todos"];
    toggled(collapsed, "ideas");
    expect(collapsed).toEqual(["todos"]);
  });
});
