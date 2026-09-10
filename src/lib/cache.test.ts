import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => ({ wrapped: fn }),
  revalidateTag: vi.fn(),
}));

const { cachedRead, invalidateCache, serialized, QUEUE_STALL_MS } = await import("./cache");
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

describe("serialized", () => {
  it("runs queued work one at a time, in order", async () => {
    const order: string[] = [];
    let finishFirst!: () => void;
    const first = serialized("order", async () => {
      await new Promise<void>((resolve) => (finishFirst = resolve));
      order.push("first");
      return 1;
    });
    const second = serialized("order", async () => {
      order.push("second");
      return 2;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual([]);
    finishFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(order).toEqual(["first", "second"]);
  });

  it("lets the next computation run after one that failed", async () => {
    const failed = serialized("failure", async () => {
      throw new Error("boom");
    });
    await expect(failed).rejects.toThrow("boom");
    await expect(serialized("failure", async () => "next")).resolves.toBe("next");
  });

  it("stops waiting for a predecessor that never finishes", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      void serialized("stuck", () => new Promise<never>(() => {}));
      let ran = false;
      const next = serialized("stuck", async () => {
        ran = true;
        return "ran anyway";
      });
      await vi.advanceTimersByTimeAsync(QUEUE_STALL_MS - 1);
      expect(ran).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(next).resolves.toBe("ran anyway");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('"stuck"');
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });
});
