"use client";

import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * `tone` picks the ground this sits on: "sidebar" for the foot of the navy
 * rail (half the width, beside Inbox), "dark" for a navy band, "light" for
 * the cream auth panels.
 */
export function SignOutButton({ tone = "dark" }: { tone?: "dark" | "light" | "sidebar" }) {
  const router = useRouter();

  async function signOut() {
    await createSupabaseBrowserClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={signOut}
      className={
        tone === "light"
          ? "btn-secondary px-5 py-3 text-sm"
          : tone === "sidebar"
            ? "flex-1 border-2 border-navy-500 py-[7px] text-[11px] font-bold whitespace-nowrap text-cream/60 transition hover:border-orange-brand hover:text-orange-brand"
            : "border-2 border-navy-500 px-3 py-1.5 text-xs font-semibold tracking-[0.08em] text-cream uppercase transition hover:border-orange-brand hover:text-orange-brand"
      }
    >
      Sign out
    </button>
  );
}
