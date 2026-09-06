"use client";

import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function SignOutButton() {
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
      className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-navy-800 transition hover:border-orange-brand hover:text-orange-brand"
    >
      Sign out
    </button>
  );
}
