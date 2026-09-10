/**
 * Caps how many queries a postgres-js client has in flight at once.
 *
 * postgres-js does not queue a query when every pooled connection is busy:
 * it pipelines it onto one of the busy connections (`busy.shift()` in its
 * pool handler) and only starts queueing once a connection carries a
 * hundred of them. Against Supabase's transaction-mode pooler a pipelined
 * query hangs forever — the connection sits in ClientRead and nothing on it
 * ever answers — which is the wedge described in client.ts. With `max: 8`
 * that means the ninth simultaneous query on a server instance can hang,
 * and under Fluid Compute several requests share one instance and one
 * pool, so "nine at once" is a normal Tuesday rather than a stress test.
 * The manager dashboard alone issues up to ten in one batch.
 *
 * This gate holds the ninth query back until a connection is free, so the
 * pool only ever sees as many queries as it has connections. A transaction
 * holds one permit for its whole duration, because it holds one connection
 * for its whole duration.
 */

/** A first-come, first-served counting semaphore. */
export class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`Semaphore limit must be a positive integer, got ${limit}`);
    }
  }

  /** How many permits are currently held. */
  get inFlight(): number {
    return this.active;
  }

  /** How many callers are waiting for a permit. */
  get queued(): number {
    return this.waiting.length;
  }

  /** Resolves with a release function once a permit is free. Release is idempotent. */
  acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const grant = () => {
        this.active += 1;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.active -= 1;
          this.waiting.shift()?.();
        });
      };
      if (this.active < this.limit) grant();
      else this.waiting.push(grant);
    });
  }

  /** Runs `work` under a permit, releasing it however `work` ends. */
  async run<T>(work: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await work();
    } finally {
      release();
    }
  }
}

/**
 * The parts of a postgres-js query this gate touches. `handler` is the
 * pool's dispatch function, which the query calls exactly once, on its
 * first `then`/`execute`; swapping it on the instance is how the dispatch
 * is deferred until a permit is free.
 */
interface GateableQuery extends Promise<unknown> {
  handler: ((query: GateableQuery) => void) & { debug?: unknown };
  cancelled: unknown;
  reject: (reason: unknown) => void;
}

function isGateableQuery(value: unknown): value is GateableQuery {
  return (
    value instanceof Promise &&
    typeof (value as { handler?: unknown }).handler === "function" &&
    typeof (value as { reject?: unknown }).reject === "function"
  );
}

/**
 * Defers a query's dispatch until a permit is free, and releases the permit
 * when the query settles. Returns the same query object, so `.values()` and
 * friends still chain on it.
 */
function gateQuery<Q>(query: Q, permits: Semaphore): Q {
  if (!isGateableQuery(query)) return query;
  const dispatch = query.handler;
  const gated = ((q: GateableQuery) => {
    void permits.acquire().then((release) => {
      // Cancelled while waiting: postgres-js has already rejected it.
      if (q.cancelled) {
        release();
        return;
      }
      // Promise.prototype.then, not q.then — the query's own then() would
      // dispatch it a second time.
      void Promise.prototype.then.call(q, release, release);
      try {
        dispatch(q);
      } catch (error) {
        q.reject(error);
      }
    });
  }) as GateableQuery["handler"];
  gated.debug = dispatch.debug;
  query.handler = gated;
  return query;
}

/**
 * Wraps a postgres-js client so no more than `limit` queries are ever in
 * flight together. Everything else on the client passes straight through.
 */
export function withQueryGate<C extends object>(client: C, limit: number): C {
  const permits = new Semaphore(limit);

  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;

      if (property === "unsafe") {
        return (...args: unknown[]) => gateQuery(Reflect.apply(value, target, args), permits);
      }
      if (property === "begin") {
        return (...args: unknown[]) =>
          permits.run(() => Reflect.apply(value, target, args) as Promise<unknown>);
      }
      return value.bind(target);
    },
    apply(target, _thisArg, args) {
      // The tagged-template form: sql`select …`. Not used by Drizzle, but a
      // query is a query.
      return gateQuery(Reflect.apply(target as unknown as (...a: unknown[]) => unknown, target, args), permits);
    },
  });
}
