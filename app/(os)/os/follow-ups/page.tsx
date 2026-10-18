import FollowupsScreen from "@/components/os/followups/followups-screen";
import { PageHead } from "@/components/os/page-head";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { loadFollowups } from "@/lib/os/followups-data";

export default async function FollowupsPage() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;

  const now = new Date();
  let data;
  try {
    data = await loadFollowups(workspaceId, now);
  } catch (err) {
    console.error("[OS Follow-ups] load failed:", err);
  }

  return (
    <>
      <PageHead title="Follow-ups" description="J's nudges to quiet threads and the Friday resource sends. Nothing goes out until you press send." />
      {data ? <FollowupsScreen data={data} now={now.getTime()} /> : <div className="os-banner">Follow-ups didn&apos;t load. Refresh in a minute.</div>}
    </>
  );
}
