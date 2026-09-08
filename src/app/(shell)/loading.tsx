/**
 * Shown the instant a nav link is clicked, for every route under the shell
 * that hasn't finished its own data fetch yet — without this, Next.js has
 * nothing to render until that fetch resolves, so the whole app feels frozen
 * on every tab switch instead of navigating immediately.
 *
 * Generic on purpose: one skeleton for every page under (shell), not a
 * per-route replica. `motion-reduce:animate-none` mirrors the blanket
 * reduced-motion kill in globals.css, which only reaches inline `style`
 * animations and a couple of named classes — a Tailwind utility class like
 * `animate-pulse` needs its own opt-out.
 */
export default function ShellLoading() {
  const pulse = "animate-pulse motion-reduce:animate-none";

  return (
    <>
      <div className="border-b-2 border-ink bg-navy-800">
        <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-3 px-6 py-7">
          <div className="flex flex-col gap-2.5">
            <div className={`h-8 w-64 bg-navy-700 ${pulse}`} />
            <div className={`h-3 w-40 bg-navy-700 ${pulse}`} />
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-3 border-2 border-ink bg-surface px-5 pt-[18px] pb-4">
              <div className={`h-2.5 w-20 bg-line ${pulse}`} />
              <div className={`h-9 w-24 bg-line ${pulse}`} />
              <div className={`h-1.5 w-full bg-line ${pulse}`} />
            </div>
          ))}
        </div>

        <div className="mt-4 h-64 border-2 border-ink bg-surface p-5">
          <div className={`h-2.5 w-48 bg-line ${pulse}`} />
          <div className={`mt-6 h-40 w-full bg-line ${pulse}`} />
        </div>
      </main>
    </>
  );
}
