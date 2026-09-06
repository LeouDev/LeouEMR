"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { BrandLockup } from "@/components/brand";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { EMPTY_SIGNUP, SignupFields, type SignupDetails } from "./signup-fields";

type Mode = "signin" | "signup";

const fieldClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-navy-900 outline-none transition focus:border-navy focus:ring-2 focus:ring-navy-100";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("signin");
  const [details, setDetails] = useState<SignupDetails>(EMPTY_SIGNUP);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);

    const supabase = createSupabaseBrowserClient();

    if (mode === "signup") {
      // Exactly 9 digits, including any leading zeros — every employee ID
      // in the source data has this shape, so a shorter entry usually means
      // the leading zeros were dropped by a spreadsheet.
      const employeeEid = details.employeeEid.trim();
      if (!/^\d{9}$/.test(employeeEid)) {
        setError(
          "Employee ID must be exactly 9 digits, including any leading zeros (e.g. 001895123)",
        );
        setSubmitting(false);
        return;
      }

      // The details travel as auth metadata so the database trigger can
      // write the account and its 201 file in one transaction, before the
      // new user has a session of their own.
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { ...details, employeeEid } },
      });
      if (signUpError) {
        setError(signUpError.message);
        setSubmitting(false);
        return;
      }
      setNotice(
        "Account created. An administrator needs to approve it and assign your role before you can sign in.",
      );
      setDetails(EMPTY_SIGNUP);
      setMode("signin");
      setSubmitting(false);
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(signInError.message);
      setSubmitting(false);
      return;
    }

    router.push(searchParams.get("next") ?? "/dashboard");
    router.refresh();
  }

  return (
    <div className={`w-full ${mode === "signup" ? "max-w-2xl" : "max-w-md"}`}>
      <BrandLockup />

      <div className="mt-8 overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
        <div className="h-1 bg-gradient-to-r from-navy-800 via-navy to-orange-brand" />
        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <div>
            <h1 className="text-base font-semibold text-navy-900">
              {mode === "signin" ? "Sign in" : "Request an account"}
            </h1>
            <p className="mt-0.5 text-sm text-muted">
              {mode === "signin"
                ? "Access your performance workspace"
                : "An administrator will approve and assign your role"}
            </p>
          </div>

          {mode === "signup" && (
            <SignupFields
              values={details}
              onChange={(key, value) => setDetails((prev) => ({ ...prev, [key]: value }))}
            />
          )}

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-navy-800">
              {mode === "signup" ? "Optum email address" : "Email"}
            </span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={fieldClass}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-navy-800">Password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={fieldClass}
            />
          </label>

          {error && (
            <p role="alert" className="rounded-lg bg-fail-bg px-3 py-2 text-sm text-fail">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="rounded-lg bg-pass-bg px-3 py-2 text-sm text-pass">
              {notice}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-navy-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-navy-900 focus:ring-2 focus:ring-navy-100 focus:outline-none disabled:opacity-50"
          >
            {submitting ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>

          <button
            type="button"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
              setNotice(null);
            }}
            className="w-full text-center text-sm font-medium text-orange-brand underline-offset-4 transition hover:text-orange-brand-dark hover:underline"
          >
            {mode === "signin" ? "Need an account? Request one" : "Already have an account? Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-cream px-4 py-10">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
