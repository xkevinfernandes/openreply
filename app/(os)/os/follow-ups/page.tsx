import FollowupsTimeline from "@/components/os/followups/timeline";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { loadFollowupsHeader, type FollowupsHeader } from "@/lib/os/followups-header";
import { filterTimeline, timelineTab } from "@/lib/os/followups-timeline";
import { loadTimeline } from "@/lib/os/followups-timeline-data";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ tab?: string; src?: string }> };

export default async function FollowupsPage({ searchParams }: PageProps) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  const params = await searchParams;
  const tab = timelineTab(params.tab);

  let data;
  let header: FollowupsHeader = { setupHref: "/os/knowledge", friday: null };
  try {
    [data, header] = await Promise.all([
      loadTimeline(workspaceId, new Date()),
      loadFollowupsHeader(workspaceId).catch((err) => {
        console.error("[OS Follow-ups] header:", err);
        return header;
      }),
    ]);
  } catch (err) {
    console.error("[OS Follow-ups] load failed:", err);
    return <div className="os-banner">Follow-ups didn&apos;t load. Refresh in a minute.</div>;
  }
  const source = data.sources.some((s) => s.key === params.src) ? params.src! : "all";
  return <FollowupsTimeline data={filterTimeline(data, source)} tab={tab} source={source} header={header} />;
}
