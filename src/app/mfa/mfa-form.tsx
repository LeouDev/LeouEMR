"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { fieldClass, labelClass } from "../login/signup-fields";

type Phase =
  | { kind: "loading" }
  | { kind: "enrol"; factorId: string; qr: string; secret: string }
  | { kind: "verify"; factorId: string }
  | { kind: "done" }
  | { kind: "failed"; message: string };

const FRIENDLY_NAME = "Authenticator app";

export function MfaForm({ required, next }: { required: boolean; next: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createSupabaseBrowserClient();
      const [{ data: factors, error: listError }, { data: level }] = await Promise.all([
        supabase.auth.mfa.listFactors(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      ]);
      if (cancelled) return;
      if (listError) {
        setPhase({ kind: "failed", message: listError.message });
        return;
      }
      const verified = factors?.totp.find((f) => f.status === "verified");
      if (verified) {
        setPhase(level?.currentLevel === "aal2" ? { kind: "done" } : { kind: "verify", factorId: verified.id });
        return;
      }
      // A half-finished enrolment (the page was closed before the first
      // code) would block a fresh one under the same name; clear it.
      for (const stale of factors?.totp.filter((f) => f.status !== "verified") ?? []) {
        await supabase.auth.mfa.unenroll({ factorId: stale.id });
      }
      const { data: enrolment, error: enrolError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: FRIENDLY_NAME,
      });
      if (cancelled) return;
      if (enrolError || !enrolment) {
        setPhase({
          kind: "failed",
          message: enrolError?.message ?? "The authenticator could not be set up. Ask an administrator.",
        });
        return;
      }
      setPhase({ kind: "enrol", factorId: enrolment.id, qr: enrolment.totp.qr_code, secret: enrolment.totp.secret });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (phase.kind !== "enrol" && phase.kind !== "verify") return;
    setError(null);
    setBusy(true);
    const supabase = createSupabaseBrowserClient();
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: phase.factorId,
      code: code.trim(),
    });
    if (verifyError) {
      setError("That code was not accepted. Codes change every 30 seconds — try the current one.");
      setBusy(false);
      return;
    }
    // A full navigation, so the upgraded session cookie travels with it.
    window.location.assign(next);
  }

  if (phase.kind === "loading") {
    return <p className="text-base text-muted">Checking your authenticator…</p>;
  }
  if (phase.kind === "failed") {
    return (
      <p role="alert" className="border-2 border-fail bg-fail-bg px-4 py-3 text-sm font-semibold text-fail">
        {phase.message}
      </p>
    );
  }
  if (phase.kind === "done") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-base leading-relaxed text-muted">
          Your authenticator app is set up and this session has passed the second step. If you change
          phones, ask an administrator to reset it so you can set it up again.
        </p>
        <a href={next} className="btn-primary inline-block px-5 py-4 text-center text-base">
          Continue
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-[22px]">
      {phase.kind === "enrol" ? (
        <>
          <p className="text-base leading-relaxed text-muted">
            {required
              ? "Before you continue, pair an authenticator app with your account. "
              : "Pair an authenticator app with your account. "}
            Open Microsoft Authenticator or Google Authenticator on your phone, add an account, and scan this
            code. Then enter the six digits it shows.
          </p>
          <div className="flex flex-col items-center gap-3 border-2 border-line bg-white p-4">
            {/* Supabase returns the QR as an SVG data URL. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={phase.qr} alt="QR code for your authenticator app" width={192} height={192} />
            <p className="text-center text-xs text-muted">
              Cannot scan? Enter this key by hand:
              <br />
              <span className="font-mono text-sm break-all text-ink select-all">{phase.secret}</span>
            </p>
          </div>
        </>
      ) : (
        <p className="text-base leading-relaxed text-muted">
          Enter the six-digit code from your authenticator app.
        </p>
      )}

      <label className="flex flex-col gap-2">
        <span className={labelClass}>Six-digit code</span>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className={`${fieldClass} font-mono text-lg tracking-[0.3em]`}
        />
      </label>

      {error && (
        <p role="alert" className="border-2 border-fail bg-fail-bg px-4 py-3 text-sm font-semibold text-fail">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy || code.length !== 6} className="btn-primary px-5 py-4 text-base">
        {busy ? "Checking…" : phase.kind === "enrol" ? "Pair and continue" : "Continue"}
      </button>
    </form>
  );
}
