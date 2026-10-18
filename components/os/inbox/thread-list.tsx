"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { InboxThread } from "@/lib/os/inbox";
import { entryLabels, kindTabs, shortAgo, stageLabels } from "@/lib/os/labels";
import Avatar from "@/components/os/inbox/avatar";
import { TriageBar, TriageSuggestion } from "@/components/os/inbox/triage";
import { isUnsure } from "@/lib/os/triage-copy";
import { initialSource, threadName } from "@/components/os/inbox/names";

interface ThreadListProps {
  threads: InboxThread[];
  tab: string;
  selected: string | null;
  now: number;
  /** Contacts with a draft from J waiting for approval. */
  draftContactIds: string[];
  /** Show only threads with a draft ready (Sales tab). */
  draftsOnly: boolean;
  /** Production without Jev or a model: "Sort with J" explains instead. */
  triageDisabled?: boolean;
}

export default function ThreadList({ threads, tab, selected, now, draftContactIds, draftsOnly, triageDisabled = false }: ThreadListProps) {
  const [query, setQuery] = useState("");
  // Rows the user just sorted: they leave at once, before the server answers.
  const [decided, setDecided] = useState<Set<string>>(() => new Set());
  const decide = (contactId: string, on: boolean) =>
    setDecided((prev) => {
      const next = new Set(prev);
      if (on) next.add(contactId);
      else next.delete(contactId);
      return next;
    });

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of threads) c[t.contact?.kind ?? "UNSORTED"] = (c[t.contact?.kind ?? "UNSORTED"] ?? 0) + 1;
    return c;
  }, [threads]);

  const kind = kindTabs.find((k) => k.tab === tab)?.kind ?? "SALES";
  const hasDraft = useMemo(() => new Set(draftContactIds), [draftContactIds]);
  const readyCount = threads.filter((t) => t.contact?.kind === "SALES" && hasDraft.has(t.contact.id)).length;
  const onlyDrafts = draftsOnly && kind === "SALES";
  const keep = onlyDrafts ? "&drafts=1" : "";
  const unsorted = threads.filter((t) => t.contact?.kind === "UNSORTED");
  const suggestedCount = unsorted.filter((t) => t.contact?.suggestedKind).length;
  const flagged = threads.filter((t) => t.contact?.kind === "PERSONAL" && t.contact.suggestedKind === "SALES").length;
  // Only while J's suggestion is still on the contact: once the server has
  // the move, the row shows normally wherever it now belongs.
  const leaving = (t: InboxThread) => Boolean(t.contact && (t.contact.suggestedKind || isUnsure(t.contact)) && decided.has(t.contact.id));
  const confirmAll = (on: boolean) => {
    for (const t of unsorted) if (t.contact?.suggestedKind) decide(t.contact.id, on);
  };
  const q = query.trim().toLowerCase().replace(/^@/, "");
  const matching = threads.filter(
    (t) =>
      (t.contact?.kind ?? "UNSORTED") === kind &&
      (!onlyDrafts || (t.contact && hasDraft.has(t.contact.id))) &&
      (!q ||
        (t.username ?? "").toLowerCase().includes(q) ||
        (t.fullName ?? "").toLowerCase().includes(q) ||
        (t.preview ?? "").toLowerCase().includes(q))
  );
  // On Unsorted, the ones J isn't sure about sit in their own group at the end.
  const unsureRows = kind === "UNSORTED" ? matching.filter((t) => isUnsure(t.contact)) : [];
  const visible = unsureRows.length ? matching.filter((t) => !isUnsure(t.contact)) : matching;
  const unsureLeft = unsureRows.filter((t) => !leaving(t)).length;

  const renderRow = (t: InboxThread) => (
    <li key={t.conversationId} className="os-thread-item" data-leaving={leaving(t) ? "true" : undefined}>
      <div className="os-thread-inner">
      <Link
        href={`/os/inbox?tab=${tab}${keep}&c=${encodeURIComponent(t.conversationId)}`}
        className="os-thread"
        aria-current={t.conversationId === selected ? "true" : undefined}
      >
        <Avatar src={t.avatarUrl} username={initialSource(t.username, t.fullName)} className="avatar" />
        <span className="body">
          <span className="row">
            <span className="name" data-hidden={t.username ? undefined : "true"}>
              {threadName(t.username, t.fullName)}
            </span>
            <span className="when">
              {shortAgo(t.updatedTime, now)}
              {t.unreadCount ? (
                <span className="os-unread" aria-label={`${t.unreadCount} unread`}>
                  {t.unreadCount > 99 ? "99+" : t.unreadCount}
                </span>
              ) : null}
            </span>
          </span>
          <span className="preview">{t.preview || "No preview"}</span>
          {t.contact && kind === "SALES" && (
            <span className="chips">
              {t.contact.entryPath && <span className="chip">{entryLabels[t.contact.entryPath] ?? t.contact.entryPath}</span>}
              <span className="chip">{stageLabels[t.contact.stage]}</span>
              {t.contact.setterStage && <span className="chip quiet">J · {t.contact.setterStage}</span>}
              {hasDraft.has(t.contact.id) && <span className="chip ready">Draft ready</span>}
            </span>
          )}
        </span>
      </Link>
      {t.contact && kind !== "SALES" && ((t.contact.suggestedKind && (kind === "UNSORTED" || t.contact.suggestedKind === "SALES")) || isUnsure(t.contact)) && (
        <TriageSuggestion
          contactId={t.contact.id}
          kind={t.contact.kind}
          suggestedKind={t.contact.suggestedKind}
          confidence={t.contact.suggestedConfidence}
          reason={t.contact.suggestedReason}
          onDecided={decide}
        />
      )}
      </div>
    </li>
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
            {k.kind === "PERSONAL" && flagged > 0 && (
              <span className="os-tab-flag" title={`${flagged} may be sales`}>
                <span className="sr-only">{flagged} may be sales</span>
              </span>
            )}
          </Link>
        ))}
      </div>
      {kind === "SALES" && (
        <div className="os-queue-bar">
          <Link
            href={onlyDrafts ? "/os/inbox?tab=sales" : "/os/inbox?tab=sales&drafts=1"}
            className="os-queue-chip"
            aria-pressed={onlyDrafts}
            data-empty={readyCount === 0 ? "true" : undefined}
          >
            <span className="dot" aria-hidden="true" />
            Drafts ready
            <span className="count">{readyCount}</span>
          </Link>
        </div>
      )}
      {kind === "UNSORTED" && (
        <TriageBar unsortedCount={unsorted.length} suggestedCount={suggestedCount} onConfirmAll={confirmAll} disabled={triageDisabled} />
      )}
      <label className="os-search">
        <span className="sr-only">Search conversations</span>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" />
          <path d="m10.5 10.5 3 3" />
        </svg>
        <input
          id="inbox-search"
          type="search"
          placeholder="Search conversations"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      <ul className="os-threads">
        {visible.length === 0 && unsureRows.length === 0 && (
          <li className="os-threads-empty">
            {q ? "No conversations match." : onlyDrafts ? "No drafts waiting. J writes one when someone replies." : kind === "UNSORTED" ? "Nothing to sort. Nice." : "No conversations here yet."}
          </li>
        )}
        {visible.map(renderRow)}
        {unsureRows.length > 0 && (
          <li className="os-threads-group" data-empty={unsureLeft === 0 ? "true" : undefined} aria-hidden={unsureLeft === 0 ? "true" : undefined}>
            <span>J isn&apos;t sure</span>
            <span className="count">{unsureLeft}</span>
          </li>
        )}
        {unsureRows.map(renderRow)}
      </ul>
    </div>
  );
}
