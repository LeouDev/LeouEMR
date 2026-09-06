import { redirect } from "next/navigation";
import { PageBand } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { AdherenceUploader } from "./adherence-uploader";

/**
 * A team lead uploads the NICE WFM "Adherence" PDF export and gets back a
 * clean per-agent timeline of scheduled vs. actual activity, so they can
 * work through it segment by segment and decide what needs coding — without
 * wading through the report's own summary and percentage tables, which this
 * tool never shows.
 *
 * Nothing here is stored: parsing happens per request and the result lives
 * only in the browser tab that uploaded it.
 */
export default async function AdherencePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");
  // A hidden tab is not a permission check; every restricted page re-checks.
  if (user.role === "agent") redirect("/dashboard");

  return (
    <>
      <PageBand
        title="Adherence Coding"
        subtitle="Upload the WFM adherence PDF to review segments needing action"
      />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <AdherenceUploader />
      </main>
    </>
  );
}
