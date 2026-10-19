"use client";

// The thread list (InboxA left pane): title with the green draft count,
// search, Sales · Personal · Pitches · Unsorted, rows with a stage pill and a
// green "Draft". Collapses to the avatar rail (InboxA2), remembered in the
// os_inbox_list cookie so the server renders it without a flash. J/K move
// through the rows. Owner: S1.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { INBOX_LIST_COOKIE, inboxListView, neighbourHref } from "@/components/os/inbox/categories";
import { TriageBar, TriageSuggestion } from "@/components/os/inbox/triage";
import { useOsCommand } from "@/components/os/keys";
import { Avatar, AvatarRail } from "@/components/os/ui";
import type { InboxThread } from "@/lib/os/inbox";
import { isUnsure } from "@/lib/os/triage-copy";

interface InboxListProps {
  threads: InboxThread[];
  tab: string;
  selected: string | null;
  now: number;
  draftContactIds: string[];
  collapsed: boolean;
  triageDisabled?: boolean;
}

const chevron = (d: string) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

export default function InboxList({ threads, tab, selected, now, draftContactIds, collapsed: initial, triageDisabled = false }: InboxListProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(initial);
  const view = useMemo(
    () => inboxListView(threads, { tab, query, draftContactIds, selected, now }),
    [threads, tab, query, draftContactIds, selected, now]
  );
  const unsorted = threads.filter((t) => t.contact?.kind === "UNSORTED");
  const byId = useMemo(() => new Map(threads.map((t) => [t.conversationId, t])), [threads]);

  useOsCommand("next", () => {
    const href = neighbourHref(view.rows, 1);
    if (href) router.push(href);
  });
  useOsCommand("prev", () => {
    const href = neighbourHref(view.rows, -1);
    if (href) router.push(href);
  });

  function toggle(next: boolean) {
    setCollapsed(next);
    document.cookie = `${INBOX_LIST_COOKIE}=${next ? "rail" : "full"}; path=/; max-age=31536000; samesite=lax`;
  }

  if (collapsed) {
    return (
      <div className="os-ix-rail">
        <button type="button" className="os-ix-iconbtn" aria-label="Expand thread list" title="Expand thread list" aria-expanded="false" onClick={() => toggle(false)}>
          {chevron("m6 4 4 4-4 4")}
        </button>
        {view.drafts ? (
          <span className="os-ix-drafts" title={`${view.drafts} ${view.drafts === 1 ? "draft" : "drafts"} waiting`}>
            <span className="os-dot" data-tone="mark" aria-hidden="true" />
            {view.drafts}
          </span>
        ) : null}
        <AvatarRail
          ariaLabel="Threads"
          items={view.rows.map((r) => ({ id: r.conversationId, name: r.name, avatarUrl: r.avatarUrl, href: r.href, dot: r.draft, current: r.current }))}
        />
      </div>
    );
  }

  const kind = view.categories.find((c) => c.tab === tab)?.kind ?? "SALES";

  return (
    <section className="os-ix-list" aria-label="Threads">
      <div className="os-ix-list-head">
        <div className="os-ix-title">
          <h1>Inbox</h1>
          <span className="os-ix-title-side">
            {view.drafts ? (
              <span className="os-ix-drafts">
                <span className="os-dot" data-tone="mark" aria-hidden="true" />
                {view.drafts} {view.drafts === 1 ? "draft" : "drafts"}
              </span>
            ) : null}
            <button type="button" className="os-ix-iconbtn" aria-label="Collapse thread list" title="Collapse thread list" aria-expanded="true" onClick={() => toggle(true)}>
              {chevron("M10 4 6 8l4 4")}
            </button>
          </span>
        </div>
        <label className="os-ix-search">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" />
            <path d="m10.5 10.5 3 3" />
          </svg>
          <input type="search" placeholder="Search threads" aria-label="Search threads" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="os-ix-seg" role="tablist" aria-label="Categories">
          {view.categories.map((c) => (
            <Link key={c.tab} href={`/os/inbox?tab=${c.tab}`} role="tab" aria-selected={c.tab === tab} className="os-ix-seg-tab">
              {c.label}
              {c.drafts ? <span className="os-ix-seg-n">{c.drafts}</span> : null}
            </Link>
          ))}
        </div>
      </div>
      {kind === "UNSORTED" && unsorted.length ? (
        <TriageBar unsortedCount={unsorted.length} suggestedCount={unsorted.filter((t) => t.contact?.suggestedKind).length} disabled={triageDisabled} />
      ) : null}
      <ul className="os-ix-rows">
        {view.rows.length === 0 ? <li className="os-ix-empty">{query ? "No threads match." : kind === "PITCHES" ? "No pitches. J never drafts here." : "Nothing here yet."}</li> : null}
        {view.rows.map((r) => {
          const t = byId.get(r.conversationId);
          const c = t?.contact;
          const triage = c && kind !== "SALES" && ((c.suggestedKind && (kind === "UNSORTED" || c.suggestedKind === "SALES")) || isUnsure(c));
          return (
            <li key={r.conversationId}>
              <Link href={r.href} className="os-ix-row" aria-current={r.current ? "page" : undefined}>
                <Avatar name={r.name} src={r.avatarUrl} size={32} />
                <span className="os-ix-row-body">
                  <span className="os-ix-row-top">
                    <span className="os-ix-row-name">{r.name}</span>
                    <span className="os-ix-row-time">{r.time}</span>
                  </span>
                  <span className="os-ix-row-preview">{r.preview}</span>
                  {r.stage || r.draft || r.note || r.unread ? (
                    <span className="os-ix-row-meta">
                      {r.stage ? <span className="os-ix-stage">{r.stage}</span> : null}
                      {r.draft ? (
                        <span className="os-ix-draft">
                          <span className="os-dot" data-tone="mark" aria-hidden="true" />
                          Draft
                        </span>
                      ) : null}
                      {r.unread && !r.draft ? <span className="os-ix-unread">{r.unread > 99 ? "99+" : r.unread} new</span> : null}
                      {r.note ? <span className="os-ix-note">{r.note}</span> : null}
                    </span>
                  ) : null}
                </span>
              </Link>
              {triage && c ? (
                <TriageSuggestion contactId={c.id} kind={c.kind} suggestedKind={c.suggestedKind} confidence={c.suggestedConfidence} reason={c.suggestedReason} />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
