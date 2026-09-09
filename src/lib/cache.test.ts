import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => ({ wrapped: fn }),
  revalidateTag: vi.fn(),
}));

const { cachedRead, invalidateCache } = await import("./cache");
const nextCache = await import("next/cache");

describe("cachedRead outside the Next.js server", () => {
  const runtime = process.env.NEXT_RUNTIME;
  afterEach(() => {
    if (runtime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = runtime;
  });

  it("hands back the read itself, so scripts and tests run it directly", () => {
    delete process.env.NEXT_RUNTIME;
    const read = async () => 1;
    expect(cachedRead("x", ["imports"], read)).toBe(read);
    invalidateCache("imports");
    expect(nextCache.revalidateTag).not.toHaveBeenCalled();
  });

  it("wraps the read only when the Next.js runtime is present", () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const read = async () => 1;
    expect(cachedRead("x", ["imports"], read)).not.toBe(read);
    invalidateCache("imports", "ramp");
    expect(nextCache.revalidateTag).toHaveBeenCalledTimes(2);
    expect(nextCache.revalidateTag).toHaveBeenCalledWith("imports", { expire: 0 });
  });
});
