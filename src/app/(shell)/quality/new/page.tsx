import { Card, EmptyState } from "@/components/ui";
import { getQaAgentOptions, getQaForms } from "@/lib/queries/quality";
import { requireQualityUser, todayIso } from "../access";
import { QualityBand, QualityTabs } from "../quality-tabs";
import { AuditForm } from "./audit-form";

export default async function NewAuditPage({ searchParams }: { searchParams: Promise<{ agent?: string }> }) {
  const user = await requireQualityUser();
  const [params, agents, forms] = await Promise.all([searchParams, getQaAgentOptions(user), getQaForms()]);
  const initialAgentId = agents.some((a) => a.id === params.agent) ? params.agent! : "";

  return (
    <>
      <QualityBand />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <QualityTabs active="new" />
        {agents.length === 0 ? (
          <Card>
            <EmptyState title="No one to audit" description="Agents appear here once the roster places them under you." />
          </Card>
        ) : forms.length === 0 ? (
          <Card>
            <EmptyState title="No audit forms" description="The audit forms have not been loaded into this environment yet." />
          </Card>
        ) : (
          <AuditForm agents={agents} forms={forms} evaluatorName={user.name} initialAgentId={initialAgentId} today={todayIso()} />
        )}
      </main>
    </>
  );
}
