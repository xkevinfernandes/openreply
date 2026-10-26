"use client";

// The thread list: one newest-first stream (dm-crm 009-014). Head: title with
// the drafts count, search, the status filter (Unread · All · Recent ·
// Starred, then Drafts waiting / Window closing / Spam / Archived under
// "More") and the Category filter. Rows: unread mark, star, stage pill, green
// "Draft", a checkbox for the bulk bar (tag, Won / Lost, archive, spam).
// Collapses to the avatar rail, remembered in the os_inbox_list cookie. J/K
// move through the rows.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { INBOX_LIST_COOKIE, neighbourHref, streamRows } from "@/components/os/inbox/categories";
import InboxBulkBar from "@/components/os/inbox/bulk-bar";
import { ResortPitches, TriageBar, TriageSuggestion } from "@/components/os/inbox/triage";
import { useOsCommand } from "@/components/os/keys";
import { Avatar, AvatarRail, EmptyState, InfoTip } from "@/components/os/ui";
import { FailDot, useFailedRuns } from "@/components/os/workflows/run-line";
import { CATEGORY_FILTERS, STATUS_FILTERS, inboxStreamHref, type InboxParams, type StatusFilter, type StreamThread } from "@/lib/os/inbox-stream";
import { isUnsure } from "@/lib/os/triage-copy";

interface InboxListProps {
  /** The stream under the current filters, newest first. */
  threads: StreamThread[];
  counts: Record<StatusFilter, number>;
  params: InboxParams;
  selected: string | null;
  now: number;
  draftContactIds: string[];
  collapsed: boolean;
  triageDisabled?: boolean;
  /** Unsorted contacts in the whole stream (the Sort with J bar). */
  unsorted: { total: number; suggested: number };
}

/** Rows drawn before "Show more". */
const PAGE = 50;

const PRIMARY: StatusFilter[] = ["unread", "all", "recent", "starred"];
const MORE = STATUS_FILTERS.filter((f) => !PRIMARY.includes(f.key));

const chevron = (d: string) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

export const starIcon = (filled: boolean) => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true">
    <path d="m8 1.9 1.8 3.8 4.1.5-3 2.9.8 4.1L8 11.2l-3.7 2 .8-4.1-3-2.9 4.1-.5L8 1.9Z" />
  </svg>
);

export default function InboxList({ threads, counts, params, selected, now, draftContactIds, collapsed: initial, triageDisabled = false, unsorted }: InboxListProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(initial);
  const [shown, setShown] = useState(PAGE);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const rows = useMemo(() => streamRows(threads, { params, query, draftContactIds, selected, now }), [threads, params, query, draftContactIds, selected, now]);
  const visible = rows.slice(0, shown);
  const byId = useMemo(() => new Map(threads.map((t) => [t.conversationId, t])), [threads]);
  const failed = useFailedRuns(threads.flatMap((t) => (t.contact?.id ? [t.contact.id] : [])));
  const drafts = counts.drafts;
  const filterKey = `${params.filter}:${params.cat}`;

  // A new filter starts a new selection and page.
  const [seenKey, setSeenKey] = useState(filterKey);
  if (seenKey !== filterKey) {
    setSeenKey(filterKey);
    setPicked(new Set());
    setShown(PAGE);
  }

  useOsCommand("next", () => {
    const href = neighbourHref(rows, 1);
    if (href) router.push(href);
  });
  useOsCommand("prev", () => {
    const href = neighbourHref(rows, -1);
    if (href) router.push(href);
  });

  function toggle(next: boolean) {
    setCollapsed(next);
    document.cookie = `${INBOX_LIST_COOKIE}=${next ? "rail" : "full"}; path=/; max-age=31536000; samesite=lax`;
  }

  function pick(contactId: string, on: boolean) {
    setPicked((cur) => {
      const next = new Set(cur);
      if (on) next.add(contactId);
      else next.delete(contactId);
      return next;
    });
  }

  if (collapsed) {
    return (
      <div className="os-ix-rail">
        <button type="button" className="os-ix-iconbtn" aria-label="Expand thread list" title="Expand thread list" aria-expanded="false" onClick={() => toggle(false)}>
          {chevron("m6 4 4 4-4 4")}
        </button>
        {drafts ? (
          <span className="os-ix-drafts" title={`${drafts} ${drafts === 1 ? "draft" : "drafts"} waiting`}>
            <span className="os-dot" data-tone="warn" aria-hidden="true" />
            {drafts}
          </span>
        ) : null}
        <AvatarRail
          ariaLabel="Threads"
          items={visible.map((r) => ({ id: r.conversationId, name: r.name, avatarUrl: r.avatarUrl, href: r.href, dot: r.draft || Boolean(r.unread), current: r.current }))}
        />
      </div>
    );
  }

  const go = (p: Partial<InboxParams>) => router.push(inboxStreamHref({ ...params, ...p }, selected));
  const moreActive = !PRIMARY.includes(params.filter);
  const pickedIds = [...picked];
  const allPicked = visible.length > 0 && visible.every((r) => !r.contactId || picked.has(r.contactId));
  const tip = STATUS_FILTERS.find((f) => f.key === params.filter && (f.key === "unread" || f.key === "closing"))?.tip;

  return (
    <section className="os-ix-list" aria-label="Threads" data-picking={picked.size ? "true" : undefined}>
      <div className="os-ix-list-head">
        <div className="os-ix-title">
          <h1>Inbox</h1>
          <span className="os-ix-title-side">
            {drafts ? (
              <Link className="os-ix-drafts" href={inboxStreamHref({ ...params, filter: "drafts" })} title="Drafts waiting">
                <span className="os-dot" data-tone="warn" aria-hidden="true" />
                {drafts} {drafts === 1 ? "draft" : "drafts"}
              </Link>
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
        <div className="os-ix-seg" role="tablist" aria-label="Status">
          {PRIMARY.map((key) => {
            const f = STATUS_FILTERS.find((x) => x.key === key)!;
            const n = counts[key];
            return (
              <Link key={key} href={inboxStreamHref({ ...params, filter: key })} role="tab" aria-selected={params.filter === key} className="os-ix-seg-tab" title={f.tip}>
                {f.label}
                {key === "unread" && n ? <span className="os-ix-seg-n">{n}</span> : null}
              </Link>
            );
          })}
        </div>
        <div className="os-ix-filters">
          <span className="os-select os-ix-filter" data-on={params.cat !== "any" || undefined}>
            <select aria-label="Category" value={params.cat} onChange={(e) => go({ cat: e.target.value as InboxParams["cat"] })}>
              {CATEGORY_FILTERS.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.key === "any" ? "Category" : c.label}
                </option>
              ))}
            </select>
          </span>
          <span className="os-select os-ix-filter" data-on={moreActive || undefined}>
            <select aria-label="More filters" value={moreActive ? params.filter : ""} onChange={(e) => go({ filter: (e.target.value || "all") as StatusFilter })}>
              <option value="">More</option>
              {MORE.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                  {counts[f.key] ? ` · ${counts[f.key]}` : ""}
                </option>
              ))}
            </select>
          </span>
          {tip ? <InfoTip label="About this filter">{tip}</InfoTip> : null}
        </div>
      </div>
      {params.cat === "unsorted" && unsorted.total ? <TriageBar unsortedCount={unsorted.total} suggestedCount={unsorted.suggested} disabled={triageDisabled} /> : null}
      {params.cat === "pitches" && !triageDisabled ? <ResortPitches /> : null}
      <ul className="os-ix-rows">
        {rows.length === 0 ? (
          <li className="os-ix-empty">
            {query ? (
              <EmptyState title="No threads match">Try a name or a word from the chat.</EmptyState>
            ) : params.filter === "unread" ? (
              <EmptyState title="All read" />
            ) : params.filter === "spam" ? (
              <EmptyState title="No spam" />
            ) : params.cat === "pitches" ? (
              <EmptyState title="No pitches">J never drafts here.</EmptyState>
            ) : (
              <EmptyState title="Nothing here" />
            )}
          </li>
        ) : null}
        {visible.map((r) => {
          const t = byId.get(r.conversationId);
          const c = t?.contact;
          const triage = c && c.kind !== "SALES" && ((c.suggestedKind && (c.kind === "UNSORTED" || c.suggestedKind === "SALES")) || isUnsure(c));
          const on = Boolean(r.contactId && picked.has(r.contactId));
          return (
            <li key={r.conversationId} className="os-ix-item" data-picked={on || undefined}>
              {r.contactId ? (
                <input type="checkbox" className="os-ix-check" aria-label={`Select ${r.name}`} checked={on} onChange={(e) => pick(r.contactId!, e.target.checked)} />
              ) : null}
              <Link href={r.href} className="os-ix-row" aria-current={r.current ? "page" : undefined} data-unread={r.unread ? "true" : undefined}>
                <Avatar name={r.name} src={r.avatarUrl} size={32} />
                <span className="os-ix-row-body">
                  <span className="os-ix-row-top">
                    <span className="os-ix-row-name">{r.name}</span>
                    {r.starred ? (
                      <span className="os-ix-star" aria-label="Starred">
                        {starIcon(true)}
                      </span>
                    ) : null}
                    <FailDot reason={c ? failed[c.id] : undefined} />
                    <span className="os-ix-row-time">{r.time}</span>
                    {r.unread ? (
                      r.unread.count ? (
                        <span className="os-ix-unread-n" aria-label={`${r.unread.count} new`}>
                          {r.unread.count > 99 ? "99+" : r.unread.count}
                        </span>
                      ) : (
                        <span className="os-ix-unread-dot" role="img" aria-label="Unread" title="Unread. Replies typed in the Instagram app don't mark it read." />
                      )
                    ) : null}
                  </span>
                  <span className="os-ix-row-preview">{r.preview}</span>
                  {r.stage || r.draft || r.note ? (
                    <span className="os-ix-row-meta">
                      {r.stage ? <span className="os-ix-stage">{r.stage}</span> : null}
                      {r.draft ? (
                        <span className="os-ix-draft">
                          <span className="os-dot" data-tone="warn" aria-hidden="true" />
                          Draft
                        </span>
                      ) : null}
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
        {rows.length > shown ? (
          <li className="os-ix-more">
            <button type="button" className="os-button ghost" onClick={() => setShown((n) => n + PAGE)}>
              Show more ({rows.length - shown})
            </button>
          </li>
        ) : null}
      </ul>
      {picked.size ? (
        <InboxBulkBar
          ids={pickedIds}
          filter={params.filter}
          allPicked={allPicked}
          onAll={(on) => setPicked(on ? new Set(visible.flatMap((r) => (r.contactId ? [r.contactId] : []))) : new Set())}
          onDone={() => setPicked(new Set())}
        />
      ) : null}
    </section>
  );
}
