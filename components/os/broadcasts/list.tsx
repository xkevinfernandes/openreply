"use client";

// Automations › Broadcasts (Automations board): one row per broadcast, newest
// first. Each is sent once and kept; next Friday is Duplicate on last
// Friday's. The head and tabs match Workflows and Campaigns.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { duplicateAction, newBroadcastAction, type ActionResult } from "@/app/(os)/os/automations/broadcasts/actions";
import { AutomationsTabs, type AutomationsTab } from "@/components/os/automations/automations-tabs";
import { EmptyState, Pill } from "@/components/os/ui";
import type { BroadcastListItem } from "@/lib/os/broadcasts/engine";

function useGo() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const go = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else if (r.href) router.push(r.href);
    });
  return { pending, error, go };
}

export default function BroadcastList({ items, counts }: { items: BroadcastListItem[] | null; counts?: Partial<Record<AutomationsTab, number>> }) {
  const { pending, error, go } = useGo();
  const newButton = (
    <button type="button" className="os-button primary os-auto-new" disabled={pending} onClick={() => go(() => newBroadcastAction())}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 3.5v9M3.5 8h9" />
      </svg>
      New broadcast
    </button>
  );
  return (
    <div className="os-bcl os-auto">
      <header className="os-auto-head">
        <h1 className="os-bcl-title os-title">Automations</h1>
        {newButton}
      </header>
      <AutomationsTabs active="broadcasts" counts={counts} />
      {error ? (
        <div className="os-tl-msg" data-bad role="status">
          {error}
        </div>
      ) : null}
      {items === null ? <div className="os-banner">Broadcasts didn&apos;t load. Refresh in a minute.</div> : null}
      {items && !items.length ? <EmptyState title="No broadcasts yet" action={newButton} /> : null}
      {items && items.length ? (
        <section aria-label="Broadcasts" className="os-bcl-wrap">
          <table className="os-bcl-table">
            <thead>
              <tr>
                <th scope="col">Broadcast</th>
                <th scope="col">Date</th>
                <th scope="col">To tag</th>
                <th scope="col">Messages</th>
                <th scope="col">Personalised</th>
                <th scope="col">Status</th>
                <th scope="col">Sent</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.key}>
                  <td data-label="Broadcast">
                    <Link href={`/os/automations/broadcasts/${b.key}`} className="os-bcl-name">
                      {b.name}
                    </Link>
                  </td>
                  <td data-label="Date" className="os-bcl-num">
                    {b.date}
                  </td>
                  <td data-label="To tag">
                    <span className="os-bcl-tag">{b.tag || "—"}</span>
                  </td>
                  <td data-label="Messages" className="os-bcl-sub">
                    {b.messages}
                  </td>
                  <td data-label="Personalised" className="os-bcl-sub">
                    {b.personalised}
                  </td>
                  <td data-label="Status">
                    <Pill tone={b.tone}>{b.statusLabel}</Pill>
                  </td>
                  <td data-label="Sent" className="os-bcl-num">
                    {b.sent}
                  </td>
                  <td className="os-bcl-act">
                    <button type="button" className="os-button os-bcl-dup" disabled={pending} onClick={() => go(() => duplicateAction(b.key))}>
                      Duplicate
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
