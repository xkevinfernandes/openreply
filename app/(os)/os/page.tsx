import { ComingSoon, PageHead } from "@/components/os/page-head";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { getHomeStats } from "@/lib/os/home";

export default async function OsHome() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;

  const { today, stats } = await getHomeStats(workspaceId);

  return (
    <>
      <PageHead eyebrow={today} title="Home" />
      <section className="os-stats" aria-label="This week">
        {stats.map((s) => (
          <div className="os-stat" key={s.label}>
            <div className="label">{s.label}</div>
            <div className="value">{s.value}</div>
          </div>
        ))}
      </section>
      <ComingSoon title="Setter funnel">
        Drafts waiting, 24h windows closing and the opener-to-booked funnel show here once J runs on the
        worker (build step 3).
      </ComingSoon>
    </>
  );
}
