import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * The email-confirmation exchange, both directions.
 *
 * verifyOtp is the boundary worth locking in: a wrong `type` string, a
 * missing param, or a Supabase error must all land on the same safe
 * fallback rather than a raw 500 — this is a link a person clicks from
 * their email client, often days later, sometimes twice.
 */

const verifyOtp = vi.hoisted(() => vi.fn());

class Redirected extends Error {
  constructor(public to: string) {
    super(`redirect:${to}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { verifyOtp } }),
}));

const { GET } = await import("./route");

// GET only ever reads `.url`, which a plain Request shares with NextRequest —
// the cast avoids pulling in Next's heavier request machinery for a test
// that doesn't exercise it.
const request = (query: string) =>
  new Request(`http://localhost/auth/confirm${query}`) as unknown as NextRequest;

beforeEach(() => {
  verifyOtp.mockReset();
});

describe("GET /auth/confirm", () => {
  it("verifies the token hash and lands a confirmed signup on /pending", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const failure = await GET(request("?token_hash=abc123&type=signup")).then(
      () => null,
      (e: unknown) => e,
    );
    expect(verifyOtp).toHaveBeenCalledWith({ type: "signup", token_hash: "abc123" });
    expect(failure).toBeInstanceOf(Redirected);
    expect((failure as Redirected).to).toBe("/pending");
  });

  it("sends a rejected token back to login with an explanation, not a crash", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "Token has expired or is invalid" } });
    const failure = await GET(request("?token_hash=expired&type=signup")).then(
      () => null,
      (e: unknown) => e,
    );
    expect((failure as Redirected).to).toBe("/login?error=confirmation_failed");
  });

  it("rejects a type outside the known set without ever calling Supabase", async () => {
    const failure = await GET(request("?token_hash=abc123&type=not-a-real-type")).then(
      () => null,
      (e: unknown) => e,
    );
    expect(verifyOtp).not.toHaveBeenCalled();
    expect((failure as Redirected).to).toBe("/login?error=confirmation_failed");
  });

  it("handles a link with no params instead of throwing", async () => {
    const failure = await GET(request("")).then(
      () => null,
      (e: unknown) => e,
    );
    expect(verifyOtp).not.toHaveBeenCalled();
    expect((failure as Redirected).to).toBe("/login?error=confirmation_failed");
  });
});
