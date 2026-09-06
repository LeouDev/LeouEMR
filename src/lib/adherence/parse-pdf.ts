import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.mjs";

/**
 * pdf.js has no real Worker to hand off to in a serverless function, so it
 * falls back to a "fake worker" that dynamically imports its own worker
 * module by a path relative to wherever pdf.mjs itself ends up on disk. That
 * relative import breaks once Next.js bundles this module into a serverless
 * chunk — the worker file isn't there anymore, and the error names the
 * chunk's own missing-file path, not this one. Assigning the message
 * handler here short-circuits that lookup entirely: pdf.js checks this
 * global first (see PDFWorker's `_setupFakeWorkerGlobal`) and only reaches
 * the dynamic import if it's unset. Importing the worker module normally,
 * as done above, is what makes Next's bundler trace and include it at all.
 */
(globalThis as { pdfjsWorker?: { WorkerMessageHandler: unknown } }).pdfjsWorker = {
  WorkerMessageHandler,
};

/**
 * The slice of pdf.js's TextItem this module needs. Declared locally rather
 * than imported — pdfjs-dist doesn't re-export the type from its package
 * entry point, only from an internal path not meant to be imported directly.
 */
interface PdfTextItem {
  str: string;
  transform: number[];
}

/**
 * One row of the adherence report's per-agent timeline: what was scheduled
 * against what actually happened, and the report's own explanation of the
 * gap between them (a team lead codes off this, not off the summary
 * percentage tables further down the same report).
 */
export interface AdherenceSegment {
  scheduledFrom: string | null;
  scheduledTo: string | null;
  scheduledDuration: string | null;
  actualFrom: string | null;
  actualTo: string | null;
  actualDuration: string | null;
  scheduledActivity: string | null;
  actualActivity: string | null;
  variance: string | null;
}

export interface AdherenceAgentDay {
  agentId: string;
  agentName: string;
  date: string | null;
  segments: AdherenceSegment[];
}

const TIME_TOKEN = /\d{1,2}:\d{2}\s*(?:AM|PM)|--:--|\d{2}:\d{2}/g;
const DETAIL_HEADER =
  /^From\s+To\s+Duration\s+From\s+To\s+Duration\s+Activity\s+Activity\s+Description$/;

/**
 * Column boundaries read off the report's own header row x-positions
 * (Scheduled From/To/Duration, Actual From/To/Duration, then the two
 * Activity columns and Variance Description). The report is a fixed
 * NICE Workforce Management export, so these hold across every page.
 */
function columnFor(x: number): "time" | "schedActivity" | "actualActivity" | "variance" {
  if (x < 235) return "time";
  if (x < 360) return "schedActivity";
  if (x < 460) return "actualActivity";
  return "variance";
}

function normTime(value: string | undefined): string | null {
  if (!value || value === "--:--") return null;
  return value;
}

interface Line {
  y: number;
  items: { str: string; x: number }[];
}

/**
 * Parses a NICE Workforce Management "Adherence" PDF export into structured
 * per-agent, per-segment rows.
 *
 * The report has no machine-readable table structure — everything is
 * positioned text. Each detail row's six time slots are read positionally
 * (items left of the Scheduled Activity column), and the two activity names
 * plus the variance note are bucketed by x-position using the header row's
 * own column starts. A variance note that wraps to a second printed line
 * carries no time-column content, so it is detected purely by that absence
 * and appended to the previous row rather than starting a new one.
 *
 * The report also prints the "Adherence <date range>" banner and a running
 * footer on every page, and a "Scheduled\nActivities ..." summary table
 * after each agent's detail rows, whose two header words fall on different
 * printed lines and so cannot be matched as one line — the exit trigger
 * below matches "Activities" alone for that reason. Any row a page's
 * boilerplate manages to slip through the leader anyway is caught by the
 * final filter: a genuine row always names an activity or a time.
 */
export async function parseAdherencePdf(bytes: Uint8Array): Promise<AdherenceAgentDay[]> {
  const doc = await getDocument({ data: bytes, useSystemFonts: true }).promise;

  const agents: AdherenceAgentDay[] = [];
  let currentAgent: { id: string; name: string } | null = null;
  let currentDate: string | null = null;
  let segments: AdherenceSegment[] = [];
  let inDetailTable = false;

  function flushAgent() {
    if (currentAgent && segments.length > 0) {
      agents.push({
        agentId: currentAgent.id,
        agentName: currentAgent.name,
        date: currentDate,
        segments,
      });
    }
    segments = [];
  }

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const items = content.items
      .filter((it): boolean => "transform" in it)
      .map((it) => it as unknown as PdfTextItem)
      .filter((it) => it.str.trim() !== "")
      .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }));

    const byY = new Map<number, { str: string; x: number }[]>();
    for (const it of items) {
      const y = Math.round(it.y * 3) / 3;
      const arr = byY.get(y) ?? [];
      arr.push({ str: it.str, x: it.x });
      byY.set(y, arr);
    }
    const lines: Line[] = [...byY.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([y, lineItems]) => ({ y, items: lineItems.sort((a, b) => a.x - b.x) }));

    for (const line of lines) {
      const text = line.items.map((i) => i.str).join(" ");

      const agentMatch = text.match(/^Agent\s*:\s*(\S+)\s+(.+)$/);
      if (agentMatch) {
        flushAgent();
        currentAgent = { id: agentMatch[1], name: agentMatch[2].trim() };
        inDetailTable = false;
        continue;
      }
      const dateMatch = text.match(/^Date\s*:\s*(\S+)$/);
      if (dateMatch) {
        currentDate = dateMatch[1];
        continue;
      }
      if (DETAIL_HEADER.test(text)) {
        inDetailTable = true;
        continue;
      }
      if (text.includes("Activities")) {
        inDetailTable = false;
        continue;
      }
      if (!inDetailTable || !currentAgent) continue;

      const hasTimeColumnContent = line.items.some((i) => columnFor(i.x) === "time");
      if (!hasTimeColumnContent) {
        // A wrapped continuation of the previous row's variance text.
        const last = segments[segments.length - 1];
        if (last) last.variance = [last.variance, text.trim()].filter(Boolean).join(" ");
        continue;
      }

      const times = text.match(TIME_TOKEN) ?? [];
      const buckets = { schedActivity: [] as string[], actualActivity: [] as string[], variance: [] as string[] };
      for (const i of line.items) {
        const col = columnFor(i.x);
        if (col === "time") continue;
        buckets[col].push(i.str);
      }

      segments.push({
        scheduledFrom: normTime(times[0]),
        scheduledTo: normTime(times[1]),
        scheduledDuration: normTime(times[2]),
        actualFrom: normTime(times[3]),
        actualTo: normTime(times[4]),
        actualDuration: normTime(times[5]),
        scheduledActivity: buckets.schedActivity.join(" ").trim() || null,
        actualActivity: buckets.actualActivity.join(" ").trim() || null,
        variance: buckets.variance.join(" ").trim() || null,
      });
    }
  }
  flushAgent();

  // Page boilerplate (running headers/footers) occasionally has an item
  // positioned in the time-column zone and so gets treated as a row; a
  // genuine row always carries a real time or activity name.
  for (const agent of agents) {
    agent.segments = agent.segments.filter(
      (s) => s.scheduledActivity || s.actualActivity || s.scheduledFrom || s.actualFrom,
    );
  }

  return agents.filter((a) => a.segments.length > 0);
}
