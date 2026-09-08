"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthLayout, LoadingScene, PanelHeading } from "@/components/loading-scene";
import { SCENE_SECONDS, holdForScene } from "@/lib/ui/scene-timing";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { EMPTY_SIGNUP, SignupFields, fieldClass, labelClass, type SignupDetails } from "./signup-fields";

type Mode = "signin" | "signup";

function LoginForm() {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("signin");
  const [details, setDetails] = useState<SignupDetails>(EMPTY_SIGNUP);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // A failed /auth/confirm exchange lands back here with this param — a
  // link that's already been used, or one old enough to have expired.
  const [error, setError] = useState<string | null>(() =>
    searchParams.get("error") === "confirmation_failed"
      ? "That confirmation link is invalid or has expired. Sign up again to get a new one."
      : null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    // Validate before the scene starts: a rejected employee ID should
    // correct itself immediately, not six seconds later.
    const employeeEid = details.employeeEid.trim();
    if (mode === "signup" && !/^\d{9}$/.test(employeeEid)) {
      setError(
        "Employee ID must be exactly 9 digits, including any leading zeros (e.g. 001895123)",
      );
      return;
    }

    setSubmitting(true);
    const startedAt = Date.now();
    const supabase = createSupabaseBrowserClient();

    if (mode === "signup") {
      // The details travel as auth metadata so the database trigger can
      // write the account and its 201 file in one transaction, before the
      // new user has a session of their own.
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { ...details, employeeEid } },
      });
      if (signUpError) {
        // Fail fast: making someone watch the full scene only to be told
        // their email is taken is the wrong trade.
        setError(signUpError.message);
        setSubmitting(false);
        return;
      }

      await holdForScene(startedAt);
      setNotice(
        "Account created. Check your email for a confirmation link, then wait for an administrator to approve your account and assign your role before signing in.",
      );
      setDetails(EMPTY_SIGNUP);
      setMode("signin");
      setSubmitting(false);
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(
        signInError.code === "email_not_confirmed"
          ? "Confirm your email using the link we sent you before signing in."
          : signInError.message,
      );
      setSubmitting(false);
      return;
    }

    await holdForScene(startedAt);

    // A full document navigation, not router.push.
    //
    // The session cookie is written by the browser client during sign-in; a
    // client-side navigation can reach the server before that cookie is
    // visible to it, so middleware bounces straight back to /login. Because
    // that lands on the same route this component never unmounts, and the
    // loading scene stays up forever with no way out. Asking the browser for
    // a fresh document guarantees the cookie travels with the request.
    const next = searchParams.get("next") ?? "/dashboard";
    window.location.assign(next);

    // If the navigation has not taken effect shortly after, something is
    // wrong — surface it rather than leaving the scene spinning.
    setTimeout(() => {
      setSubmitting(false);
      setError(
        "Signed in, but the dashboard did not load. Please try again — if this repeats, tell your administrator.",
      );
    }, 8000);
  }

  if (submitting) {
    return (
      <LoadingScene
        seconds={SCENE_SECONDS}
        kicker={mode === "signup" ? "Setting up" : "Signing in"}
        title={mode === "signup" ? "Building your workspace." : "Bringing the center online."}
        steps={[
          mode === "signup" ? "Creating your account" : "Authenticating credentials",
          "Syncing weekly performance data",
          "Preparing your dashboard",
        ]}
      />
    );
  }

  return (
    <AuthLayout>
      <form
        onSubmit={handleSubmit}
        className={`fade-up flex w-full flex-col gap-[22px] ${mode === "signup" ? "max-w-[640px]" : "max-w-[420px]"
        }`}
      >
        <PanelHeading
          kicker={mode === "signin" ? "Sign in" : "Sign up"}
          title={mode === "signin" ? "Welcome back." : "Create your account."}
        />

        {mode === "signup" && (
          <SignupFields
            values={details}
            onChange={(key, value) => setDetails((prev) => ({ ...prev, [key]: value }))}
          />
        )}

        <label className="flex flex-col gap-2">
          <span className={labelClass}>{mode === "signup" ? "Optum email address" : "Work email"}</span>
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="name@optum.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={fieldClass}
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className={labelClass}>Password</span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            placeholder={mode === "signup" ? "At least 8 characters" : "••••••••"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={fieldClass}
          />
        </label>

        {error && (
          <p role="alert" className="border-2 border-fail bg-fail-bg px-4 py-3 text-sm font-semibold text-fail">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="border-2 border-pass bg-pass-bg px-4 py-3 text-sm font-semibold text-pass">
            {notice}
          </p>
        )}

        <button
          type="submit"
          className="btn-primary px-5 py-4 text-base"
        >
          {mode === "signin" ? "Sign in" : "Create account"}
        </button>

        <div className="flex gap-2 border-t-2 border-line pt-[18px] text-sm">
          <span className="text-muted">
            {mode === "signin" ? "New to the command center?" : "Already have an account?"}
          </span>
          <button
            type="button"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
              setNotice(null);
            }}
            className="font-semibold text-orange-brand transition hover:text-orange-brand-dark"
          >
            {mode === "signin" ? "Create an account" : "Sign in"}
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
