"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { markAllRead } from "./actions";

export function MarkAllReadButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await markAllRead();
        setBusy(false);
        router.refresh();
      }}
      className="border border-line px-3 py-1.5 text-sm font-medium text-ink transition hover:border-orange-brand hover:text-orange-brand disabled:opacity-50"
    >
      {busy ? "Marking…" : "Mark all read"}
    </button>
  );
}
