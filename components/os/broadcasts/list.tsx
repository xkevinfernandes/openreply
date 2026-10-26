// Automations › Broadcasts: one row per broadcast. The head and the tabs are
// the same as Workflows and Campaigns (Workflows · Campaigns · Broadcasts,
// with counts), so switching tabs never moves the header.
import Link from "next/link";
import { AutomationsTabs, type AutomationsTab } from "@/components/os/automations/automations-tabs";
import { EmptyState } from "@/components/os/ui";
import type { BroadcastListItem } from "@/lib/os/broadcasts/engine";

export default function BroadcastList({ items, counts }: { items: BroadcastListItem[] | null; counts?: Partial<Record<AutomationsTab, number>> }) {
  return (
    <div className="os-bcl os-auto">
      <header className="os-auto-head">
        <h1 className="os-bcl-title os-title">Automations</h1>
      </header>
      <AutomationsTabs active="broadcasts" counts={counts} />
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
