import { describe, expect, it, vi } from "vitest";

/**
 * pdfjs-dist is mocked at the shape parseAdherencePdf actually consumes
 * (getDocument().promise -> numPages/getPage -> getTextContent -> items),
 * rather than run against a real PDF file — this report's real export
 * carries genuine employees' names, which has no place committed to the
 * repo as a fixture. Item x/y positions below mirror the exact coordinates
 * observed from a real export (see parse-pdf.ts's column comments): time
 * columns under x=235, then Scheduled Activity, Actual Activity, Variance.
 */

function item(str: string, x: number, y: number) {
  return { str, transform: [1, 0, 0, 1, x, y] };
}

const pages = vi.hoisted(() => ({ value: [] as ReturnType<typeof item>[][] }));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: pages.value.length,
      getPage: async (n: number) => ({
        getTextContent: async () => ({ items: pages.value[n - 1] }),
      }),
    }),
  }),
}));

const { parseAdherencePdf } = await import("./parse-pdf");

const DETAIL_HEADER = [
  item("From", 27.7, 652.5),
  item("To", 67.3, 652.5),
  item("Duration", 94.9, 652.5),
  item("From", 138.7, 652.5),
  item("To", 178.3, 652.5),
  item("Duration", 205.9, 652.5),
  item("Activity", 283.8, 652.5),
  item("Activity", 394.8, 652.5),
  item("Description", 499.5, 652.5),
];

/** The summary table's header wraps "Scheduled" and "Activities" onto separate lines in the real report. */
const SUMMARY_HEADER = [item("Scheduled", 56.1, 300), item("Activities", 56.1, 290)];

describe("parseAdherencePdf", () => {
  it("parses a matched row, an unscheduled event, and a wrapped variance line", async () => {
    pages.value = [
      [
        item("Agent : 1000001 Doe, Jane", 23.9, 721.9),
        item("Date : 9/4/26", 20.0, 685.2),
        ...DETAIL_HEADER,
        // A fully matched row, no variance.
        item("2:15 PM", 22.6, 620),
        item("2:45 PM", 58.6, 620),
        item("00:30", 100.5, 620),
        item("2:15 PM", 131.4, 620),
        item("2:45 PM", 169.6, 620),
        item("00:30", 211.5, 620),
        item("CSBO-PA-OGS Fax", 265.2, 620),
        item("Fax", 395.3, 620),
        // A row with a variance that wraps onto a second printed line.
        item("2:45 PM", 22.6, 600),
        item("3:00 PM", 58.6, 600),
        item("00:15", 100.5, 600),
        item("2:45 PM", 131.4, 600),
        item("3:20 PM", 169.6, 600),
        item("00:35", 211.5, 600),
        item("Break", 265.2, 600),
        item("Break", 395.3, 600),
        item("Ended 20 Min. Late, Duration", 466.6, 600),
        item("> Schedule", 498.9, 590), // wrapped continuation, no time-column item on this line
        // An unscheduled event: no scheduled columns at all.
        item("--:--", 22.6, 570),
        item("--:--", 58.6, 570),
        item("--:--", 100.5, 570),
        item("1:58 PM", 131.4, 570),
        item("2:02 PM", 169.6, 570),
        item("00:04", 211.5, 570),
        item("State-Personal-Time", 395.3, 570),
        item("Unscheduled Event", 466.6, 570),
        ...SUMMARY_HEADER,
        item("Break", 20, 280),
        item("00:35", 100, 280),
      ],
    ];

    const agents = await parseAdherencePdf(new Uint8Array());
    expect(agents).toHaveLength(1);
    const [agent] = agents;
    expect(agent.agentId).toBe("1000001");
    expect(agent.agentName).toBe("Doe, Jane");
    expect(agent.date).toBe("9/4/26");
    expect(agent.segments).toHaveLength(3);

    const [matched, wrapped, unscheduled] = agent.segments;
    expect(matched).toEqual({
      scheduledFrom: "2:15 PM",
      scheduledTo: "2:45 PM",
      scheduledDuration: "00:30",
      actualFrom: "2:15 PM",
      actualTo: "2:45 PM",
      actualDuration: "00:30",
      scheduledActivity: "CSBO-PA-OGS Fax",
      actualActivity: "Fax",
      variance: null,
    });

    expect(wrapped.variance).toBe("Ended 20 Min. Late, Duration > Schedule");

    expect(unscheduled.scheduledFrom).toBeNull();
    expect(unscheduled.scheduledActivity).toBeNull();
    expect(unscheduled.actualFrom).toBe("1:58 PM");
    expect(unscheduled.actualActivity).toBe("State-Personal-Time");
    expect(unscheduled.variance).toBe("Unscheduled Event");
  });

  it("keeps two agents' rows separate and ignores page boilerplate between them", async () => {
    pages.value = [
      [
        item("Agent : 1000001 Doe, Jane", 23.9, 721.9),
        item("Date : 9/4/26", 20.0, 685.2),
        ...DETAIL_HEADER,
        item("9:00 AM", 22.6, 620),
        item("9:05 AM", 58.6, 620),
        item("00:05", 100.5, 620),
        item("9:00 AM", 131.4, 620),
        item("9:05 AM", 169.6, 620),
        item("00:05", 211.5, 620),
        item("Break", 265.2, 620),
        item("Break", 395.3, 620),
        ...SUMMARY_HEADER,
        item("Break", 20, 280),
        item("00:05", 100, 280),
      ],
      [
        // Running page header ("Adherence <date range>") has an item at x < 235 —
        // this must not be mistaken for a new detail row once the table has closed.
        item("Adherence", 20.0, 811.3),
        item("9/4/26 - 9/4/26", 510.6, 811.3),
        item("Agent : 2000002 Smith, Sam", 23.9, 721.9),
        item("Date : 9/4/26", 20.0, 685.2),
        ...DETAIL_HEADER,
        item("10:00 AM", 22.6, 620),
        item("10:15 AM", 58.6, 620),
        item("00:15", 100.5, 620),
        item("10:00 AM", 131.4, 620),
        item("10:15 AM", 169.6, 620),
        item("00:15", 211.5, 620),
        item("Break", 265.2, 620),
        item("Break", 395.3, 620),
        ...SUMMARY_HEADER,
        item("Break", 20, 280),
        item("00:15", 100, 280),
        item("COMENDADOR, LEOU ALVEN 9/6/26 5:06 AM", 20.0, 26.3),
        item("Page : 2 of 2", 467.1, 26.3),
      ],
    ];

    const agents = await parseAdherencePdf(new Uint8Array());
    expect(agents).toHaveLength(2);
    expect(agents[0].agentName).toBe("Doe, Jane");
    expect(agents[0].segments).toHaveLength(1);
    expect(agents[1].agentName).toBe("Smith, Sam");
    expect(agents[1].segments).toHaveLength(1);
    // No stray row from the running header or footer text on either page.
    for (const agent of agents) {
      for (const seg of agent.segments) {
        expect(JSON.stringify(seg)).not.toMatch(/COMENDADOR|Page :|Adherence/);
      }
    }
  });
});
