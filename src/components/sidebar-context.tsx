"use client";

import { createContext, useContext } from "react";

/**
 * Whether the sidebar is expanded (labels showing) or collapsed to its
 * rail. Read by the pieces that live inside it and hide their text when
 * it collapses — the profile block, the nav labels. Defaults to expanded
 * so anything rendered outside the sidebar reads as it always did.
 */
export const SidebarContext = createContext<{ open: boolean }>({ open: true });

export function useSidebarOpen(): boolean {
  return useContext(SidebarContext).open;
}
