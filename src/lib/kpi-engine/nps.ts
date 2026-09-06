/**
 * Net Promoter Score: response mix, the resulting score, and the gap to target.
 *
 * The source workbook pre-classifies every survey as 100 / 0 / -100 rather
 * than shipping a raw 0-10 rating, so classification is by sign. A 0-10
 * scale would be ambiguous here — 0 is the worst possible rating there but
 * means "passive" in this encoding — so `classifyResponse` deliberately
 * accepts only the encoded form and callers pass nothing else.
 */

export type NpsCategory = "promoter" | "passive" | "detractor";

export interface NpsMix {
  promoters: number;
  passives: number;
  detractors: number;
}

export function classifyResponse(value: number): NpsCategory {
  if (value > 0) return "promoter";
  if (value < 0) return "detractor";
  return "passive";
}

export function totalResponses(mix: NpsMix): number {
  return mix.promoters + mix.passives + mix.detractors;
}

/**
 * NPS as a percentage: the share of promoters less the share of detractors.
 * Null with no responses — a score of zero would wrongly read as "neutral
 * feedback" when the truth is "no feedback".
 */
export function computeNps(mix: NpsMix): number | null {
  const total = totalResponses(mix);
  if (total === 0) return null;
  return ((mix.promoters - mix.detractors) / total) * 100;
}

/**
 * How many additional promoters would bring the score to `target`.
 *
 * Solving (P + x - D) / (n + x) * 100 >= target for x:
 *   100(P + x - D) >= target(n + x)
 *   x(100 - target) >= target*n - 100(P - D)
 *   x >= (target*n - 100(P - D)) / (100 - target)
 *
 * Returns 0 when the target is already met. Returns null when it cannot be
 * reached by adding promoters — at a target of 100 every existing detractor
 * or passive makes it unreachable, and no finite number of promoters helps.
 */
export function promotersNeeded(mix: NpsMix, target: number): number | null {
  const current = computeNps(mix);
  if (current !== null && current >= target) return 0;
  if (target >= 100) {
    // Reachable only if nothing but promoters exists, which the check above
    // would already have caught.
    return null;
  }

  const n = totalResponses(mix);
  const needed = (target * n - 100 * (mix.promoters - mix.detractors)) / (100 - target);
  return Math.max(0, Math.ceil(needed));
}
