"use client";

import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * `tone` picks the ground this sits on: "dark" for the navy app header,
 * "light" for the cream auth panels.
 */
export function SignOutButton({ tone = "dark" }: { tone?: "dark" | "light" }) {
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
          : "border-2 border-navy-500 px-3 py-1.5 text-xs font-semibold tracking-[0.08em] text-cream uppercase transition hover:border-orange-brand hover:text-orange-brand"
      }
    >
      Sign out
    </button>
  );
}
