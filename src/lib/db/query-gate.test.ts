import { describe, expect, it, vi } from "vitest";
import { Semaphore, withQueryGate } from "./query-gate";

/**
 * The shape of a postgres-js Query that matters here: a Promise subclass
 * that calls its pool handler exactly once, asynchronously, the first time
 * it is awaited or executed (see node_modules/postgres/src/query.js).
 */
class FakeQuery extends Promise<unknown> {
  handler: ((query: FakeQuery) => void) & { debug?: unknown };
  cancelled: unknown = null;
  executed = false;
  resolve!: (value: unknown) => void;
  reject!: (reason: unknown) => void;

  static get [Symbol.species]() {
    return Promise;
  }

  constructor(handler: ((query: FakeQuery) => void) & { debug?: unknown }) {
    let resolve!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    super((a, b) => {
      resolve = a;
      reject = b;
    });
    this.resolve = resolve;
    this.reject = reject;
    this.handler = handler;
  }

  private handle() {
    if (this.executed) return;
    this.executed = true;
    void Promise.resolve().then(() => this.handler(this));
  }

  values() {
    return this;
  }

  execute() {
    this.handle();
    return this;
  }

  then<A = unknown, B = never>(
    onfulfilled?: ((value: unknown) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    this.handle();
    return super.then(onfulfilled, onrejected);
  }
}

function fakeClient() {
  const dispatched: FakeQuery[] = [];
  const handler = Object.assign((query: FakeQuery) => void dispatched.push(query), { debug: false });
  const client = Object.assign(() => new FakeQuery(handler), {
    unsafe: (statement: string, params?: unknown[]) => {
      void statement;
      void params;
      return new FakeQuery(handler);
    },
    begin: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    options: { parsers: {} as Record<string, unknown> },
    end: async () => "ended",
  });
  return { client, dispatched };
}

/** Lets queued microtasks and the gate's own promise chains run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Semaphore", () => {
  it("hands out permits first come, first served", async () => {
    const permits = new Semaphore(1);
    const order: number[] = [];
    const first = await permits.acquire();
    const second = permits.acquire().then((release) => (order.push(2), release));
    const third = permits.acquire().then((release) => (order.push(3), release));
    expect(permits.queued).toBe(2);
    first();
    (await second)();
    (await third)();
    expect(order).toEqual([2, 3]);
    expect(permits.inFlight).toBe(0);
  });

  it("releases a permit when the work throws, and ignores a double release", async () => {
    const permits = new Semaphore(1);
    await expect(permits.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(permits.inFlight).toBe(0);
    const release = await permits.acquire();
    release();
    release();
    expect(permits.inFlight).toBe(0);
  });

  it("rejects a limit that could never admit anyone", () => {
    expect(() => new Semaphore(0)).toThrow();
  });
});

describe("withQueryGate", () => {
  it("never has more queries in flight than the limit", async () => {
    const { client, dispatched } = fakeClient();
    const gated = withQueryGate(client, 2);
    const results = [1, 2, 3, 4, 5].map((n) => gated.unsafe(`select ${n}`).then((rows) => rows));
    await settle();
    expect(dispatched).toHaveLength(2);

    dispatched[0].resolve("a");
    await settle();
    expect(dispatched).toHaveLength(3);

    dispatched[1].resolve("b");
    dispatched[2].resolve("c");
    await settle();
    expect(dispatched).toHaveLength(5);
    dispatched[3].resolve("d");
    dispatched[4].resolve("e");
    await expect(Promise.all(results)).resolves.toEqual(["a", "b", "c", "d", "e"]);
  });

  it("frees the permit of a query that fails", async () => {
    const { client, dispatched } = fakeClient();
    const gated = withQueryGate(client, 1);
    const failing = gated.unsafe("select 1").then(
      () => "unexpected",
      (error: unknown) => (error as Error).message,
    );
    const next = gated.unsafe("select 2").then((rows) => rows);
    await settle();
    expect(dispatched).toHaveLength(1);

    dispatched[0].reject(new Error("statement timeout"));
    await expect(failing).resolves.toBe("statement timeout");
    await settle();
    expect(dispatched).toHaveLength(2);
    dispatched[1].resolve("ok");
    await expect(next).resolves.toBe("ok");
  });

  it("holds one permit for the whole of a transaction", async () => {
    const { client, dispatched } = fakeClient();
    const gated = withQueryGate(client, 1);
    let finish!: () => void;
    const transaction = gated.begin(
      () => new Promise<string>((resolve) => (finish = () => resolve("committed"))),
    );
    const query = gated.unsafe("select 1").then((rows) => rows);
    await settle();
    expect(dispatched).toHaveLength(0);

    finish();
    await expect(transaction).resolves.toBe("committed");
    await settle();
    expect(dispatched).toHaveLength(1);
    dispatched[0].resolve("after");
    await expect(query).resolves.toBe("after");
  });

  it("dispatches a chained query exactly once and keeps the handler's debug flag", async () => {
    const { client, dispatched } = fakeClient();
    const gated = withQueryGate(client, 4);
    const query = gated.unsafe("select 1").values();
    expect(query.handler.debug).toBe(false);
    const awaited = query.then((rows) => rows);
    await settle();
    expect(dispatched).toHaveLength(1);
    dispatched[0].resolve("rows");
    await expect(awaited).resolves.toBe("rows");
  });

  it("does not dispatch a query cancelled while it was waiting, and frees its slot", async () => {
    const { client, dispatched } = fakeClient();
    const gated = withQueryGate(client, 1);
    const first = gated.unsafe("select 1").then((rows) => rows);
    const waiting = gated.unsafe("select 2");
    const cancelled = waiting.then(
      () => "unexpected",
      (error: unknown) => (error as Error).message,
    );
    await settle();
    // What postgres-js's cancel() does to a query it has not dispatched yet.
    waiting.cancelled = true;
    waiting.reject(new Error("canceling statement due to user request"));
    await expect(cancelled).resolves.toBe("canceling statement due to user request");

    dispatched[0].resolve("one");
    await expect(first).resolves.toBe("one");
    const third = gated.unsafe("select 3").then((rows) => rows);
    await settle();
    expect(dispatched).toHaveLength(2);
    dispatched[1].resolve("three");
    await expect(third).resolves.toBe("three");
  });

  it("gates the tagged-template form too", async () => {
    const { client, dispatched } = fakeClient();
    const gated = withQueryGate(client, 1);
    const a = gated().then((rows) => rows);
    const b = gated().then((rows) => rows);
    await settle();
    expect(dispatched).toHaveLength(1);
    dispatched[0].resolve("a");
    await settle();
    expect(dispatched).toHaveLength(2);
    dispatched[1].resolve("b");
    await expect(Promise.all([a, b])).resolves.toEqual(["a", "b"]);
  });

  it("passes everything else straight through", async () => {
    const { client } = fakeClient();
    const gated = withQueryGate(client, 1);
    expect(gated.options).toBe(client.options);
    gated.options.parsers["1184"] = "parser";
    expect(client.options.parsers["1184"]).toBe("parser");
    await expect(gated.end()).resolves.toBe("ended");
  });

  it("is a no-op for something unsafe() returns that is not a query", async () => {
    const client = { unsafe: () => "not a query", begin: async () => undefined };
    const gated = withQueryGate(client, 1);
    expect(gated.unsafe()).toBe("not a query");
    const spy = vi.fn(async () => "done");
    await expect(withQueryGate({ unsafe: () => 1, begin: spy }, 1).begin()).resolves.toBe("done");
  });
});
