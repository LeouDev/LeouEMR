"use client";

import { useEffect } from "react";
import { recordActivity } from "@/app/(shell)/activity/actions";
import { manilaDay } from "@/lib/utilization/report";

const MARKER = "emr:seen";

/**
 * Tells the server this browser opened the app today, once. The marker in
 * local storage is only a throttle — the server decides the day and owns
 * the row — so a cleared storage costs one extra harmless upsert, and a
 * failed ping is simply retried on the next visit.
 */
export function ActivityPing() {
  useEffect(() => {
    const today = manilaDay();
    try {
      if (window.localStorage.getItem(MARKER) === today) return;
    } catch {
      // Storage unavailable: ping anyway, the server de-duplicates.
    }
    recordActivity()
      .then((result) => {
        if (!result.ok) return;
        try {
          window.localStorage.setItem(MARKER, today);
        } catch {
          // Nothing to do: the next visit pings again, harmlessly.
        }
      })
      .catch(() => {});
  }, []);
  return null;
}
