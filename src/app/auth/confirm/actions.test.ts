import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The email-confirmation exchange, both directions.
 *
 * verifyOtp is the boundary worth locking in: a wrong `type` string, a
 * missing field, or a Supabase error must all land on the same safe
 * fallback rather than a raw failure — this is a link a person presses from
 * their email client, often days later, sometimes twice. A password-reset
 * link lands on the page that sets the new password, everything else on
 * the pending page.
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

const { confirmLink } = await import("./actions");

function submission(fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

async function outcome(fields: Record<string, string>): Promise<string> {
  const failure = await confirmLink(submission(fields)).then(
    () => null,
    (e: unknown) => e,
  );
  expect(failure).toBeInstanceOf(Redirected);
  return (failure as Redirected).to;
}

beforeEach(() => {
  verifyOtp.mockReset();
});

describe("confirmLink", () => {
  it("verifies the token hash and lands a confirmed signup on /pending", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    expect(await outcome({ token_hash: "abc123", type: "signup" })).toBe("/pending");
    expect(verifyOtp).toHaveBeenCalledWith({ type: "signup", token_hash: "abc123" });
  });

  it("lands a password reset on the new-password page", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    expect(await outcome({ token_hash: "abc123", type: "recovery" })).toBe("/reset-password");
  });

  it("sends a rejected token back to login with an explanation, not a crash", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "Token has expired or is invalid" } });
    expect(await outcome({ token_hash: "expired", type: "signup" })).toBe("/login?error=confirmation_failed");
  });

  it("rejects a type outside the known set without ever calling Supabase", async () => {
    expect(await outcome({ token_hash: "abc123", type: "not-a-real-type" })).toBe(
      "/login?error=confirmation_failed",
    );
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("handles a submission with no fields instead of throwing", async () => {
    expect(await outcome({})).toBe("/login?error=confirmation_failed");
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});
