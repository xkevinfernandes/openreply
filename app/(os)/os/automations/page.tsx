import Link from "next/link";
import AutomationList from "@/components/os/automations/automation-list";
import { PageHead } from "@/components/os/page-head";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { parseFilter } from "@/lib/os/automations";
import { listAutomationRows } from "@/lib/os/automations-data";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ filter?: string; q?: string }> };

export default async function AutomationsPage({ searchParams }: PageProps) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  const params = await searchParams;
  const { rows, sample } = await listAutomationRows(workspaceId);

  return (
    <>
      <PageHead title="Automations" description="Comment and DM keywords that send the opener and the link. When they reply, J takes over." />

      <div className="os-auto-cards">
        <Link href="/os/knowledge" className="os-auto-card">
          <span className="os-auto-card-icon" aria-hidden="true">
            <svg viewBox="0 0 16 16">
              <path d="M3 2.5h7.5a1 1 0 0 1 1 1v10H4a1 1 0 0 1-1-1v-10Z" />
              <path d="M3 11.5a1 1 0 0 1 1-1h7.5M6 5.5h3" />
            </svg>
          </span>
          <span>
            <strong>AI Knowledge bases</strong>
            <span>What each setter knows: voice, offers, funnel and lead magnets. Pick which one answers a campaign.</span>
          </span>
          <svg className="os-auto-card-go" viewBox="0 0 16 16" aria-hidden="true">
            <path d="m6 3.5 4.5 4.5L6 12.5" />
          </svg>
        </Link>
        <Link href="/os/integrations" className="os-auto-card">
          <span className="os-auto-card-icon" aria-hidden="true">
            <svg viewBox="0 0 16 16">
              <path d="M6 2.5v3M10 2.5v3M4.5 5.5h7v2.8a3.5 3.5 0 0 1-7 0V5.5ZM8 11.8v2" />
            </svg>
          </span>
          <span>
            <strong>Integrations</strong>
            <span>Send the emails your campaigns capture to Kit, and contacts to your CRM.</span>
          </span>
          <svg className="os-auto-card-go" viewBox="0 0 16 16" aria-hidden="true">
            <path d="m6 3.5 4.5 4.5L6 12.5" />
          </svg>
        </Link>
      </div>

      <AutomationList rows={rows} sample={sample} initialFilter={parseFilter(params.filter)} initialQuery={params.q ?? ""} />
    </>
  );
}
