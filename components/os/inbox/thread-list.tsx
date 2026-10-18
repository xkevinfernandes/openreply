"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { InboxThread } from "@/lib/os/inbox";
import { entryLabels, kindTabs, shortAgo, stageLabels } from "@/lib/os/labels";

interface ThreadListProps {
  threads: InboxThread[];
  tab: string;
  selected: string | null;
  now: number;
}

export default function ThreadList({ threads, tab, selected, now }: ThreadListProps) {
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of threads) c[t.contact?.kind ?? "UNSORTED"] = (c[t.contact?.kind ?? "UNSORTED"] ?? 0) + 1;
    return c;
  }, [threads]);

  const kind = kindTabs.find((k) => k.tab === tab)?.kind ?? "SALES";
  const q = query.trim().toLowerCase().replace(/^@/, "");
  const visible = threads.filter(
    (t) =>
      (t.contact?.kind ?? "UNSORTED") === kind &&
      (!q || (t.username ?? "").toLowerCase().includes(q) || (t.preview ?? "").toLowerCase().includes(q))
  );

  return (
    <div className="os-inbox-list">
      <div className="os-tabs" role="tablist" aria-label="Conversation type">
        {kindTabs.map((k) => (
          <Link
            key={k.tab}
            href={`/os/inbox?tab=${k.tab}`}
            role="tab"
            aria-selected={k.tab === tab}
            className="os-tab"
          >
            {k.label}
            <span className="count">{counts[k.kind] ?? 0}</span>
          </Link>
        ))}
      </div>
      <label className="os-search">
        <span className="sr-only">Search conversations</span>
        <input
          id="inbox-search"
          type="search"
          placeholder="Search conversations"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      <ul className="os-threads">
        {visible.length === 0 && (
          <li className="os-threads-empty">
            {q ? "No conversations match." : kind === "UNSORTED" ? "Nothing to sort. Nice." : "No conversations here yet."}
          </li>
        )}
        {visible.map((t) => (
          <li key={t.conversationId}>
            <Link
              href={`/os/inbox?tab=${tab}&c=${encodeURIComponent(t.conversationId)}`}
              className="os-thread"
              aria-current={t.conversationId === selected ? "true" : undefined}
            >
              <span className="avatar" aria-hidden="true">
                {(t.username ?? "?").slice(0, 1).toUpperCase()}
              </span>
              <span className="body">
                <span className="row">
                  <span className="name">@{t.username ?? "unknown"}</span>
                  <span className="when">{shortAgo(t.updatedTime, now)}</span>
                </span>
                <span className="preview">{t.preview || "No preview"}</span>
                {t.contact && kind === "SALES" && (
                  <span className="chips">
                    {t.contact.entryPath && <span className="chip">{entryLabels[t.contact.entryPath] ?? t.contact.entryPath}</span>}
                    <span className="chip">{stageLabels[t.contact.stage]}</span>
                    {t.contact.setterStage && <span className="chip quiet">J · {t.contact.setterStage}</span>}
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
