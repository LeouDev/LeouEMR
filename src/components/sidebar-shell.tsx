"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { BrandMark } from "./brand";
import { SidebarContext } from "./sidebar-context";
import { SidebarNav, type NavItem } from "./sidebar-nav";
import { SidebarScene } from "./sidebar-scene";

/** The cookie that remembers a collapsed rail, so the server renders it collapsed and nothing jumps on load. */
export const SIDEBAR_COOKIE = "sidebar";
const EXPANDED = "w-[232px]";
const COLLAPSED = "md:w-16";

/**
 * The left rail: brand on top, the destinations down the middle, the
 * person and their controls at the foot, and a toggle that folds it to a
 * 64px strip. From `md` up it is a sticky column beside the page; below
 * that it is a drawer over the page, opened from a slim bar the page
 * keeps at its top, and it closes itself on navigation.
 *
 * Pure chrome: the nav items and the profile block arrive as props from
 * the server component, so nothing here depends on the route except the
 * links themselves (their own client component).
 */
export function SidebarShell({
  items,
  unread,
  initialOpen,
  profile,
  signOut,
}: {
  items: NavItem[];
  unread: number;
  initialOpen: boolean;
  /** The profile block (its own client component, with its dialog). */
  profile: ReactNode;
  signOut: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(initialOpen);
  // The drawer remembers the path it was opened on: navigating from it
  // means the destination is wanted, not the menu, so a new path closes
  // it with no effect needed.
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const drawer = drawerPath === pathname;
  const openDrawer = () => setDrawerPath(pathname);
  const closeDrawer = () => setDrawerPath(null);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerPath(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  function toggle() {
    const next = !open;
    setOpen(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "open" : "collapsed"}; path=/; max-age=31536000; samesite=lax`;
  }

  // Labels show in the drawer whatever the desktop state, and on desktop
  // only while expanded.
  const label = open ? "" : "md:hidden";
  const unreadLabel = unread > 99 ? "99+" : String(unread);

  return (
    <SidebarContext.Provider value={{ open }}>
      <div className="flex items-center justify-between border-b-2 border-orange-brand bg-navy-800 px-4 py-2.5 md:hidden print:hidden">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <BrandMark className="h-8 w-8" id="bar" />
          <span className="text-sm font-extrabold tracking-[0.02em] text-cream">EMR</span>
        </Link>
        <button
          type="button"
          onClick={openDrawer}
          aria-label="Open navigation"
          aria-expanded={drawer}
          className="border-2 border-navy-500 px-3 py-1.5 text-xs font-bold tracking-[0.08em] text-cream uppercase transition hover:border-orange-brand"
        >
          Menu
          {unread > 0 && (
            <span className="ml-2 inline-flex h-4 min-w-4 items-center justify-center bg-orange-brand px-1 text-[10px] text-white">{unreadLabel}</span>
          )}
        </button>
      </div>

      {drawer && (
        <div
          className="fixed inset-0 z-40 animate-[fadeIn_.2s_ease] bg-navy-900/60 md:hidden"
          onClick={closeDrawer}
          aria-hidden="true"
        />
      )}

      <aside
        aria-label="Navigation"
        className={`fixed inset-y-0 left-0 z-50 flex h-screen shrink-0 flex-col overflow-x-hidden overflow-y-auto border-r-2 border-orange-brand bg-navy-800 transition-[transform,width] duration-200 ease-in-out md:sticky md:top-0 md:z-auto md:translate-x-0 print:hidden ${
          drawer ? "translate-x-0" : "-translate-x-full"
        } ${EXPANDED} ${open ? "" : COLLAPSED}`}
      >
        {/* Folded, the brand and the toggle stack; the row has no room for both. */}
        <div className={`flex items-center gap-2.5 border-b-2 border-navy-500 px-4 py-[18px] ${open ? "" : "md:flex-col md:gap-3 md:px-0"}`}>
          <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5" aria-label="Dashboard">
            <BrandMark className="h-8 w-8 shrink-0" id="sidebar" />
            <span className={`min-w-0 whitespace-nowrap ${label}`}>
              <span className="block text-sm font-extrabold tracking-[0.02em] text-cream">EMR</span>
              <span className="block text-[9px] font-semibold tracking-[0.1em] text-cream/50 uppercase">Command Center</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={toggle}
            aria-label={open ? "Collapse navigation" : "Expand navigation"}
            aria-expanded={open}
            title={open ? "Collapse" : "Expand"}
            className={`hidden h-7 w-7 items-center justify-center text-cream/60 transition hover:text-orange-brand md:inline-flex ${open ? "ml-auto" : ""}`}
          >
            <PanelIcon />
          </button>
          <button
            type="button"
            onClick={closeDrawer}
            aria-label="Close navigation"
            className="ml-auto text-lg text-cream md:hidden"
          >
            ✕
          </button>
        </div>

        <nav className={`flex flex-col gap-0.5 py-2.5 ${open ? "px-3" : "px-3 md:px-1.5"}`}>
          <SidebarNav items={items} />
        </nav>

        {/* The spare height, whatever the viewport leaves: the scene scales
            to fit and gives way entirely on a short screen. Not while folded. */}
        <div aria-hidden="true" className={`min-h-0 flex-1 overflow-hidden px-3 py-2 ${label}`}>
          <SidebarScene />
        </div>

        <div className="flex flex-col gap-2.5 border-t-2 border-navy-500 px-3 py-3.5">
          {profile}
          <div className={`flex gap-2 ${label}`}>
            <Link
              href="/notifications"
              prefetch={false}
              aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`}
              className="flex flex-1 items-center justify-center gap-1.5 border-2 border-navy-500 py-[7px] text-[11px] font-bold whitespace-nowrap text-cream transition hover:border-orange-brand hover:text-orange-brand"
            >
              Inbox
              {unread > 0 && (
                <span className="inline-flex h-4 min-w-4 items-center justify-center bg-orange-brand px-1 text-[10px] text-white">{unreadLabel}</span>
              )}
            </Link>
            {signOut}
          </div>
          {/* Folded: the unread count still shows, as the one thing worth a glance. */}
          {!open && unread > 0 && (
            <Link
              href="/notifications"
              prefetch={false}
              aria-label={`Notifications, ${unread} unread`}
              className="hidden h-7 items-center justify-center bg-orange-brand text-[11px] font-bold text-white md:flex"
            >
              {unreadLabel}
            </Link>
          )}
          <button
            type="button"
            onClick={toggle}
            aria-label={open ? "Collapse navigation" : "Expand navigation"}
            aria-expanded={open}
            className="hidden w-full border-2 border-navy-500 py-[7px] text-[11px] font-bold text-cream/60 transition hover:border-orange-brand hover:text-cream md:block"
          >
            {open ? "‹" : "›"}
          </button>
        </div>
      </aside>
    </SidebarContext.Provider>
  );
}

/** The "side panel" glyph: a frame with a narrow left pane. */
function PanelIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <rect x={3} y={5} width={18} height={14} />
      <path d="M9 5v14" />
    </svg>
  );
}
