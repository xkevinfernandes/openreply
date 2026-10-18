import Link from "next/link";
import { PageHead } from "@/components/os/page-head";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { getHomeStats, getSetterOverview, type Bar, type SetterOverview } from "@/lib/os/home";

function inHours(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const h = (new Date(iso).getTime() - now) / 3600_000;
  return h < 1 ? `next closes in ${Math.max(1, Math.round(h * 60))}m` : `next closes in ${Math.round(h)}h`;
}

function Bars({ title, bars, hint }: { title: string; bars: Bar[]; hint: string }) {
  const max = Math.max(1, ...bars.map((b) => b.count));
  const total = bars.reduce((n, b) => n + b.count, 0);
  return (
    <section className="os-home-panel" aria-label={title}>
      <header>
        <h2>{title}</h2>
        <span>
          {total} {hint}
        </span>
      </header>
      <ol className="os-bars">
        {bars.map((b) => (
          <li key={b.key} data-zero={b.count === 0 || undefined}>
            <span className="lbl">{b.label}</span>
            <span className="track" aria-hidden="true">
              <span className="fill" style={{ width: `${(b.count / max) * 100}%` }} />
            </span>
            <span className="n">{b.count}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

async function overview(workspaceId: string, now: Date): Promise<SetterOverview | null> {
  try {
    return await getSetterOverview(workspaceId, now);
  } catch (err) {
    console.error("[OS Home] setter overview failed:", err);
    return null;
  }
}

export default async function OsHome() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;

  const now = new Date();
  const [{ today, stats }, setter] = await Promise.all([getHomeStats(workspaceId), overview(workspaceId, now)]);

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

      {setter ? (
        <>
          <h2 className="os-home-title">Setter</h2>
          <section className="os-stats" aria-label="Setter">
            <Link className="os-stat os-stat-link" href="/os/inbox?drafts=1" data-hot={setter.draftsWaiting > 0 || undefined}>
              <div className="label">Drafts waiting</div>
              <div className="value">{setter.draftsWaiting}</div>
              <div className="sub">J wrote them, you approve</div>
            </Link>
            <Link className="os-stat os-stat-link" href="/os/inbox" data-hot={setter.windowsClosing > 0 || undefined}>
              <div className="label">24h windows closing</div>
              <div className="value">{setter.windowsClosing}</div>
              <div className="sub">{inHours(setter.nextClose, now.getTime()) ?? "They wrote last, window open"}</div>
            </Link>
            <Link className="os-stat os-stat-link" href="/os/follow-ups" data-hot={setter.followupsDue > 0 || undefined}>
              <div className="label">Follow-ups due</div>
              <div className="value">{setter.followupsDue}</div>
              <div className="sub">Nudges and Friday sends</div>
            </Link>
          </section>
          <div className="os-home-grid">
            <Bars title="Setter funnel" bars={setter.funnel} hint="sales contacts at a J stage" />
            <Bars title="Pipeline" bars={setter.pipeline} hint="sales contacts by stage" />
          </div>
        </>
      ) : (
        <div className="os-banner">The setter numbers didn&apos;t load. Refresh in a minute.</div>
      )}
    </>
  );
}
