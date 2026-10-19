// Automations › Broadcasts: one row per broadcast. The tabs mirror the
// Automations page (S6 owns Campaigns and Tests).
import Link from "next/link";
import { EmptyState } from "@/components/os/ui";
import type { BroadcastListItem } from "@/lib/os/broadcasts/engine";

const TABS = [
  { href: "/os/automations", label: "Campaigns" },
  { href: "/os/automations/broadcasts", label: "Broadcasts", current: true },
  { href: "/os/automations/experiments", label: "Tests" },
];

export default function BroadcastList({ items }: { items: BroadcastListItem[] | null }) {
  return (
    <div className="os-bcl">
      <h1 className="os-bcl-title">Automations</h1>
      <nav className="os-tabs" aria-label="Automations">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className="os-tab" role="tab" aria-selected={Boolean(t.current)}>
            {t.label}
          </Link>
        ))}
      </nav>
      {items === null ? <div className="os-banner">Broadcasts didn&apos;t load. Refresh in a minute.</div> : null}
      {items && !items.length ? <EmptyState title="No broadcasts yet" /> : null}
      {items && items.length ? (
        <table className="os-bcl-table">
          <thead>
            <tr>
              <th scope="col">Broadcast</th>
              <th scope="col">Audience</th>
              <th scope="col">Next send</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((b) => (
              <tr key={b.key}>
                <td>
                  <Link href={`/os/automations/broadcasts/${b.key}`} className="os-bcl-name">
                    {b.name}
                  </Link>
                </td>
                <td>
                  <span className="os-bcl-tag">{b.audienceTag}</span> <span className="os-bcl-num">{b.audience}</span>
                </td>
                <td className="os-bcl-num">{b.windowLabel}</td>
                <td>
                  <span className="os-bcl-state" data-on={b.enabled || undefined} data-needs={b.needs || undefined}>
                    <span className="os-bc-dot" data-on={b.enabled || undefined} />
                    {b.enabled ? b.state : "Off"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
