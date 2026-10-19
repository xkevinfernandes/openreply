import Link from "next/link";
import { AutomationsTabs } from "@/components/os/automations/automations-tabs";
import ExperimentCard from "@/components/os/experiments/experiment-card";
import { PageHead } from "@/components/os/page-head";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { automationTabCounts } from "@/lib/os/automations-data";
import { listExperiments, type ExperimentView } from "@/lib/os/experiments/data";

export const dynamic = "force-dynamic";

const ORDER = { RUNNING: 0, PAUSED: 1, FINISHED: 2 } as const;

export default async function ExperimentsPage() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  const counts = await automationTabCounts(workspaceId);
  let list: ExperimentView[] | null = null;
  try {
    list = await listExperiments(workspaceId);
  } catch (err) {
    console.error("[OS Experiments] load failed:", err);
  }
  const sorted = list ? [...list].sort((a, b) => ORDER[a.status] - ORDER[b.status]) : null;

  return (
    <>
      <PageHead
        title="Automations"
        actions={
          <Link href="/os/automations/tests/new" className="os-button primary">
            New test
          </Link>
        }
      />
      <AutomationsTabs active="tests" counts={counts} />

      {!sorted ? (
        <div className="os-banner">Experiments didn&apos;t load. Refresh in a minute.</div>
      ) : sorted.length === 0 ? (
        <div className="os-empty os-exp-empty">
          <strong>No tests yet</strong>
          <p>Try two openers on a campaign, or two ways J asks for the call. Start with lines that point at what they did, or one specific question.</p>
          <Link href="/os/automations/tests/new" className="os-button primary">
            New test
          </Link>
        </div>
      ) : (
        <div className="os-exp-list">
          {sorted.map((e) => (
            <ExperimentCard key={e.id} exp={e} />
          ))}
        </div>
      )}
    </>
  );
}
