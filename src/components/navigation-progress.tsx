"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

interface NavigationState {
  /** True from the moment a navigation is requested until the URL changes. */
  pending: boolean;
  /** Marks a navigation as started — for a <Link>'s onNavigate. */
  start: () => void;
  /** Pushes a URL and tracks it as pending until it lands. */
  navigate: (href: string, options?: { scroll?: boolean }) => void;
}

const NavigationContext = createContext<NavigationState>({
  pending: false,
  start: () => {},
  navigate: () => {},
});

/** If a navigation has not landed in this long, stop claiming it is in progress. */
const STALE_MS = 20_000;

/**
 * One source of truth for "is the app in the middle of moving somewhere?"
 *
 * Every page under the shell renders on the server, and the main tabs do
 * not prefetch (see nav-tabs.tsx for why), so a click has nothing to show
 * until the server's first byte arrives — auth check, cold start and the
 * first database round trips all happen before the loading skeleton can
 * even appear. That silent gap is what reads as lag. This tracks the gap
 * so the header can draw a progress bar the instant a tab or filter is
 * used, and so the control that was used can show its own pending state.
 *
 * Cleared by the URL actually changing (pathname or search params), which
 * covers links, router.push and redirects alike; the timeout only guards
 * against a navigation that never lands (a dropped connection).
 */
export function NavigationProgressProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [manual, setManual] = useState(false);
  const [transitioning, startTransition] = useTransition();
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    setManual(false);
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = null;
  }, []);

  const start = useCallback(() => {
    setManual(true);
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = setTimeout(() => setManual(false), STALE_MS);
  }, []);

  const navigate = useCallback(
    (href: string, options?: { scroll?: boolean }) => {
      start();
      startTransition(() => {
        router.push(href, options);
      });
    },
    [router, start],
  );

  const value = useMemo(
    () => ({ pending: manual || transitioning, start, navigate }),
    [manual, transitioning, start, navigate],
  );

  return (
    <NavigationContext.Provider value={value}>
      {/* useSearchParams has to sit under its own Suspense boundary; the
          watcher renders nothing, it only clears the flag when the URL lands. */}
      <Suspense fallback={null}>
        <UrlWatcher onChange={clear} />
      </Suspense>
      {children}
    </NavigationContext.Provider>
  );
}

function UrlWatcher({ onChange }: { onChange: () => void }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const first = useRef(true);
  useEffect(() => {
    // The initial render is not a navigation landing.
    if (first.current) {
      first.current = false;
      return;
    }
    onChange();
  }, [pathname, search, onChange]);
  return null;
}

export function useNavigation(): NavigationState {
  return useContext(NavigationContext);
}

/**
 * The thin bar under the header that moves while a navigation is in
 * flight. Purely informational: it never blocks input, and someone who has
 * asked for reduced motion gets a still bar rather than a moving one.
 */
export function NavigationProgressBar() {
  const { pending } = useNavigation();
  return (
    <div
      role="progressbar"
      aria-hidden={!pending}
      aria-label="Loading the next page"
      aria-valuetext={pending ? "Loading" : "Idle"}
      className={`pointer-events-none relative h-[3px] w-full overflow-hidden bg-transparent transition-opacity ${
        pending ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        className={`absolute inset-y-0 left-0 w-1/3 bg-orange-brand motion-reduce:w-full motion-reduce:animate-none ${
          pending ? "animate-nav-progress" : ""
        }`}
      />
    </div>
  );
}
