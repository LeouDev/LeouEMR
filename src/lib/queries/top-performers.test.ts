import { describe, expect, it } from "vitest";
import { PODIUM_PLACES, topThree, withPhotoVersions } from "./top-performers";

describe("topThree", () => {
  it("numbers the places from one, in the order it was given", () => {
    // The rows arrive already ranked — `rank` and `rankSupervisors` sorted
    // them — so this numbers places rather than deciding them.
    expect(topThree([{ name: "A", score: 4.8 }, { name: "B", score: 4.5 }, { name: "C", score: 4.1 }])).toEqual([
      { place: 1, name: "A", score: 4.8, teamSize: null, photoId: null, photoVersion: null },
      { place: 2, name: "B", score: 4.5, teamSize: null, photoId: null, photoVersion: null },
      { place: 3, name: "C", score: 4.1, teamSize: null, photoId: null, photoVersion: null },
    ]);
  });

  it("leaves an unscored person off the podium rather than ranking them last", () => {
    // `rank` sorts the unscored behind everyone measured, so a thin month
    // would otherwise stand somebody on a pedestal for having no data.
    const rows = topThree([{ name: "A", score: 4.8 }, { name: "B", score: null }, { name: "C", score: 3.9 }]);

    expect(rows.map((r) => r.name)).toEqual(["A", "C"]);
    expect(rows.map((r) => r.place)).toEqual([1, 2]);
  });

  it("takes three and no more", () => {
    const rows = topThree(
      Array.from({ length: 12 }, (_, i) => ({ name: `Agent ${i}`, score: 5 - i * 0.1 })),
    );

    expect(rows).toHaveLength(PODIUM_PLACES);
    expect(rows.at(-1)?.name).toBe("Agent 2");
  });

  it("gives back an empty podium for a month nobody was scored in", () => {
    expect(topThree([{ name: "A", score: null }])).toEqual([]);
    expect(topThree([])).toEqual([]);
  });

  it("carries a supervisor's team size through, and leaves an agent's null", () => {
    expect(topThree([{ name: "Sup", score: 4.4, teamSize: 17 }])[0].teamSize).toBe(17);
    expect(topThree([{ name: "Agent", score: 4.4 }])[0].teamSize).toBeNull();
  });

  it("keeps a zero score, which is a result rather than an absence", () => {
    expect(topThree([{ name: "A", score: 0 }])).toHaveLength(1);
  });

  it("carries whose picture to show, for a supervisor as much as an agent", () => {
    expect(topThree([{ name: "Sup", score: 4.4, teamSize: 17, photoId: "emp-9" }])[0].photoId).toBe("emp-9");
    // A leader with no roster row has nobody's picture to point at.
    expect(topThree([{ name: "Sup", score: 4.4, teamSize: 17, photoId: null }])[0].photoId).toBeNull();
  });
});

describe("withPhotoVersions", () => {
  const person = (photoId: string | null) => ({
    place: 1,
    name: "A",
    score: 4.5,
    teamSize: null,
    photoId,
    photoVersion: null,
  });

  it("stamps the version of the picture a person actually has", () => {
    expect(withPhotoVersions([person("emp-1")], { "emp-1": 1737000000000 })[0].photoVersion).toBe(1737000000000);
  });

  it("leaves someone who has not uploaded one at null, so the page draws the fallback", () => {
    // Null here is what stops the page asking the avatar route for a
    // picture that is not there and taking a 404 on every sign-in.
    expect(withPhotoVersions([person("emp-1")], {})[0].photoVersion).toBeNull();
    expect(withPhotoVersions([person(null)], { "emp-1": 1 })[0].photoVersion).toBeNull();
  });

  it("leaves everything else about the person alone", () => {
    const [out] = withPhotoVersions([person("emp-1")], { "emp-1": 5 });
    expect(out).toMatchObject({ place: 1, name: "A", score: 4.5, photoId: "emp-1" });
  });
});
