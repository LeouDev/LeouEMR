"use client";

import { useState } from "react";
import { MIN_PASSWORD_LENGTH, PASSWORD_HINT, passwordProblem } from "@/lib/auth/password";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { fieldClass, labelClass } from "../login/signup-fields";

export function ResetPasswordForm({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const problem = passwordProblem(password, confirmation);
    if (problem) {
      setError(problem);
      return;
    }

    setSaving(true);
    const supabase = createSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      // Supabase's own reasons are worth showing as they are: too short for
      // its floor, found in a breach, or the same password again.
      setError(updateError.message);
      setSaving(false);
      return;
    }
    // A full navigation, so the refreshed session cookie travels with it.
    window.location.assign(next);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-[22px]">
      <label className="flex flex-col gap-2">
        <span className={labelClass}>New password</span>
        <input
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          placeholder={PASSWORD_HINT}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-2">
        <span className={labelClass}>Type it again</span>
        <input
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          className={fieldClass}
        />
      </label>
      {error && (
        <p role="alert" className="border-2 border-fail bg-fail-bg px-4 py-3 text-sm font-semibold text-fail">
          {error}
        </p>
      )}
      <button type="submit" disabled={saving} className="btn-primary px-5 py-4 text-base">
        {saving ? "Saving…" : "Save new password"}
      </button>
    </form>
  );
}
