// Automations › Campaigns (AutomationsA board). Broadcasts and Tests are tabs;
// the broadcasts builder is S5's /os/automations/broadcasts.

import Link from "next/link";
import { AutomationsTabs } from "@/components/os/automations/automations-tabs";
import AutomationList from "@/components/os/automations/automation-list";
import { listWorkflows } from "@/components/os/workflows/data";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { parseChip } from "@/lib/os/automations";
import { automationTabCounts, listAutomationRows, listBroadcastSummaries, type BroadcastSummary } from "@/lib/os/automations-data";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ trigger?: string }> };

const STATUS: Record<BroadcastSummary["status"], { label: string; tone: string }> = {
  needs_link: { label: "Needs link", tone: "warn" },
  review: { label: "Review", tone: "mark" },
  scheduled: { label: "Scheduled", tone: "ink" },
  done: { label: "Sent", tone: "neutral" },
  off: { label: "Draft", tone: "neutral" },
};

const CHEVRON = "M6 3.5 10.5 8 6 12.5";

export default async function AutomationsPage({ searchParams }: PageProps) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  const params = await searchParams;
  const [{ rows, sample }, broadcasts] = await Promise.all([
    listAutomationRows(workspaceId),
    listBroadcastSummaries(workspaceId).catch((err) => {
      console.error("[OS Automations] broadcasts:", err);
      return [] as BroadcastSummary[];
    }),
  ]);
  const [counts, workflows] = await Promise.all([automationTabCounts(workspaceId, rows.length), listWorkflows(workspaceId).catch(() => [])]);

  return (
    <div className="os-auto">
      <header className="os-auto-head">
        <h1 className="os-title">Automations</h1>
        <Link href="/os/automations/new" className="os-button primary os-auto-new">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 3.5v9M3.5 8h9" />
          </svg>
          New campaign
        </Link>
      </header>
      <AutomationsTabs active="campaigns" counts={{ ...counts, workflows: workflows.length }} />

      <AutomationList rows={rows} sample={sample} initialChip={parseChip(params.trigger)} />

      {broadcasts.length ? (
        <section className="os-auto-bc" aria-labelledby="os-auto-bc-h">
          <div className="os-auto-bc-head">
            <h2 id="os-auto-bc-h">Broadcasts</h2>
            <Link href="/os/automations/broadcasts">All broadcasts</Link>
          </div>
          <ul>
            {broadcasts.map((b) => (
              <li key={b.key}>
                <Link href={`/os/automations/broadcasts/${b.key}`} className="os-auto-bc-row">
                  <span className="name">{b.name}</span>
                  <span className="sub">{b.window}</span>
                  <span className="sub">{b.audience}</span>
                  <span className="st" data-tone={STATUS[b.status].tone}>
                    <span className="os-dot" data-tone={STATUS[b.status].tone} aria-hidden="true" />
                    {STATUS[b.status].label}
                  </span>
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d={CHEVRON} />
                  </svg>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
