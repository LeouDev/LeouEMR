import { redirect } from "next/navigation";
import { AuthLayout, PanelHeading } from "@/components/loading-scene";
import { isConfirmType } from "@/lib/auth/confirm-destination";
import { confirmLink } from "./actions";

/**
 * Where every email link lands: a button, not an automatic exchange.
 *
 * Corporate mail systems open each link in an email to scan it before the
 * person ever sees the message. The token in the link can be spent once,
 * and this used to spend it on that first visit, so by the time the person
 * clicked, the link was already dead ("One-time token not found"). A plain
 * visit now shows this page and spends nothing; only the form submission
 * does, and scanners do not press buttons.
 */
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const params = await searchParams;
  const tokenHash = params.token_hash ?? "";
  const type = params.type ?? "";
  if (!tokenHash || !isConfirmType(type)) redirect("/login?error=confirmation_failed");

  const recovery = type === "recovery";
  return (
    <AuthLayout>
      <form action={confirmLink} className="fade-up flex w-full max-w-[420px] flex-col gap-[22px]">
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        <PanelHeading
          kicker={recovery ? "Password reset" : "Email confirmation"}
          title={recovery ? "Choose a new password." : "Confirm your email."}
        />
        <p className="text-base leading-relaxed text-muted">
          {recovery
            ? "Press the button to continue to the page where you choose your new password. The link works once."
            : "Press the button to confirm this address. An administrator then approves your account and assigns your role before you can sign in."}
        </p>
        <button type="submit" className="btn-primary px-5 py-4 text-base">
          Continue
        </button>
      </form>
    </AuthLayout>
  );
}
