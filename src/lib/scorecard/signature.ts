import { z } from "zod";

/**
 * A drawn signature on a scorecard stamp, kept as its strokes rather than
 * a picture: a few kilobytes, sharp on paper at any size, and easy to
 * check on the server. Each stroke is a flat list of x, y pairs in the
 * pad's own coordinate space.
 */
export const SIGNATURE_WIDTH = 600;
export const SIGNATURE_HEIGHT = 200;
const MAX_POINTS = 20_000;

export interface Signature {
  w: number;
  h: number;
  strokes: number[][];
}

const pointCount = (s: { strokes: number[][] }) => s.strokes.reduce((n, stroke) => n + stroke.length / 2, 0);

/** At least two points somewhere: a single tap is not a signature. */
export function hasInk(s: { strokes: number[][] }): boolean {
  return pointCount(s) >= 2;
}

export const signatureSchema: z.ZodType<Signature> = z
  .object({
    w: z.number().int().min(100).max(2000),
    h: z.number().int().min(50).max(1000),
    strokes: z
      .array(z.array(z.number().int().min(0).max(2000)).min(2).max(4000))
      .min(1)
      .max(500),
  })
  .refine((s) => s.strokes.every((stroke) => stroke.length % 2 === 0), {
    message: "Each stroke is a list of x, y pairs",
  })
  .refine((s) => pointCount(s) <= MAX_POINTS, { message: "The signature is too detailed to store" })
  .refine(hasInk, { message: "Draw your signature before confirming" });

/** The stored value read back, or null when it is not a signature. */
export function parseSignature(value: unknown): Signature | null {
  const result = signatureSchema.safeParse(value);
  return result.success ? result.data : null;
}

/**
 * The strokes as one SVG path. A lone point becomes a zero-length segment,
 * which round line caps draw as a dot, so a dotted i survives.
 */
export function signaturePath(s: { strokes: number[][] }): string {
  return s.strokes
    .map((stroke) => {
      const points: string[] = [];
      for (let i = 0; i + 1 < stroke.length; i += 2) points.push(`${stroke[i]} ${stroke[i + 1]}`);
      if (points.length === 0) return "";
      if (points.length === 1) return `M${points[0]} L${points[0]}`;
      return `M${points[0]} L${points.slice(1).join(" L")}`;
    })
    .filter(Boolean)
    .join(" ");
}

/** When a stamp was made, in the team's own time. */
export function signedAt(date: Date): string {
  return `${date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" })} Manila time`;
}
