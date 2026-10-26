// The Inbox list as InboxA draws it: the four categories, the draft count,
// one row per thread (stage pill from the funnel view, green "Draft", a quiet
// note), and the J/K neighbours. Pure, so it is tested. Owner: S1.

import type { ContactKind } from "@/app/generated/prisma/enums";
import { columnFor, funnelColumns, type FunnelColumn } from "@/lib/os/funnel";
import type { InboxThread } from "@/lib/os/inbox";
import { kindTabs, shortAgo } from "@/lib/os/labels";
import { inboxStreamHref, unreadMark, type InboxParams, type StreamThread } from "@/lib/os/inbox-stream";
import { isSpam } from "@/lib/os/spam";

/** "rail" = the list collapsed to avatars (InboxA2). */
export const INBOX_LIST_COOKIE = "os_inbox_list";

export interface InboxRow {
  conversationId: string;
  contactId: string | null;
  name: string;
  avatarUrl: string | null;
  preview: string;
  time: string;
  /** The funnel column label ("Qualify", "Booked"). */
  stage: string | null;
  draft: boolean;
  note: string | null;
  href: string;
  current: boolean;
  unread: number;
}

export interface InboxCategory {
  kind: ContactKind;
  tab: string;
  label: string;
  total: number;
  drafts: number;
}

export interface InboxListView {
  categories: InboxCategory[];
  rows: InboxRow[];
  /** Drafts waiting across the inbox (the green "4 drafts"). */
  drafts: number;
}

export function threadDisplayName(t: Pick<InboxThread, "username" | "fullName">): string {
  return t.username ?? t.fullName ?? "Instagram user";
}

/** "/os/inbox?tab=sales&c=m1" (keeps the tab across row clicks). */
export function inboxHref(tab: string, conversationId?: string | null): string {
  const q = new URLSearchParams({ tab });
  if (conversationId) q.set("c", conversationId);
  return `/os/inbox?${q}`;
}

function note(t: InboxThread): string | null {
  const c = t.contact;
  if (!c) return null;
  if (c.paused) return "Paused";
  return null;
}

export function inboxListView(
  threads: InboxThread[],
  opts: { tab: string; query?: string; draftContactIds: Iterable<string>; selected: string | null; now: number; columns?: FunnelColumn[] }
): InboxListView {
  const drafts = new Set(opts.draftContactIds);
  const columns = opts.columns ?? funnelColumns(null);
  const label = new Map(columns.map((c) => [c.key, c.label]));
  const kindOf = (t: InboxThread): ContactKind => t.contact?.kind ?? "UNSORTED";
  const hasDraft = (t: InboxThread) => Boolean(t.contact && drafts.has(t.contact.id) && t.contact.kind === "SALES" && t.contact.stage !== "LOST");

  const categories = kindTabs.map((k) => {
    const mine = threads.filter((t) => kindOf(t) === k.kind);
    return { kind: k.kind, tab: k.tab, label: k.label, total: mine.length, drafts: mine.filter(hasDraft).length };
  });
  const kind = kindTabs.find((k) => k.tab === opts.tab)?.kind ?? "SALES";
  const q = (opts.query ?? "").trim().toLowerCase().replace(/^@/, "");

  const rows = threads
    .filter((t) => kindOf(t) === kind)
    .filter((t) => !q || [t.username, t.fullName, t.preview].some((v) => (v ?? "").toLowerCase().includes(q)))
    .map((t) => ({
      conversationId: t.conversationId,
      contactId: t.contact?.id ?? null,
      name: threadDisplayName(t),
      avatarUrl: t.avatarUrl ?? null,
      preview: t.preview || "No preview",
      time: shortAgo(t.updatedTime, opts.now),
      stage: t.contact && kind === "SALES" ? (label.get(columnFor({ stage: t.contact.stage, setterStage: t.contact.setterStage }, columns)) ?? null) : null,
      draft: hasDraft(t),
      note: note(t),
      href: inboxHref(opts.tab, t.conversationId),
      current: t.conversationId === opts.selected,
      unread: t.unreadCount ?? 0,
    }));

  return { categories, rows, drafts: categories.reduce((n, c) => n + c.drafts, 0) };
}

/** J/K: the next or previous row's href (wraps at neither end). */
export function neighbourHref(rows: Pick<InboxRow, "current" | "href">[], dir: 1 | -1): string | null {
  const i = rows.findIndex((r) => r.current);
  const next = i < 0 ? (dir === 1 ? rows[0] : rows[rows.length - 1]) : rows[i + dir];
  return next?.href ?? null;
}

/** Why J can't draft for this contact, or null. Spam and Pitches never get
 *  drafts; spam says so first (a spam thread lives under Spam, not Pitches). */
export function draftBlockedReason(c: { kind: string; paused: boolean; suggestedKind?: string | null } | null | undefined, spam = false): string | null {
  if (!c) return "Not a contact yet.";
  if (spam) return "Marked as spam. J doesn't draft here.";
  if (c.kind === "PITCHES") return "J never drafts in Pitches.";
  if (c.kind === "PERSONAL" && c.suggestedKind === "SALES") return "Looks like sales. Move them to Sales first.";
  if (c.kind !== "SALES") return "J drafts for Sales only.";
  if (c.paused) return "J is paused for this contact.";
  return null;
}

// --- One stream (dm-crm 009-014) -------------------------------------------------

export interface StreamRow extends Omit<InboxRow, "unread"> {
  /** Zernio's count when local says unread, null = a dot; absent = read. */
  unread: { count: number | null } | null;
  starred: boolean;
  spam: boolean;
  archived: boolean;
}

/** The stream's rows (already filtered and sorted by the page): search,
 *  stage pill on Sales contacts, Draft, unread mark. */
export function streamRows(
  threads: StreamThread[],
  opts: { params: InboxParams; query?: string; draftContactIds: Iterable<string>; selected: string | null; now: number; columns?: FunnelColumn[] }
): StreamRow[] {
  const drafts = new Set(opts.draftContactIds);
  const columns = opts.columns ?? funnelColumns(null);
  const label = new Map(columns.map((c) => [c.key, c.label]));
  const q = (opts.query ?? "").trim().toLowerCase().replace(/^@/, "");
  return threads
    .filter((t) => !q || [t.username, t.fullName, t.preview].some((v) => (v ?? "").toLowerCase().includes(q)))
    .map((t) => ({
      conversationId: t.conversationId,
      contactId: t.contact?.id ?? null,
      name: threadDisplayName(t),
      avatarUrl: t.avatarUrl ?? null,
      preview: t.preview || "No preview",
      time: shortAgo(t.updatedTime, opts.now),
      stage: t.contact?.kind === "SALES" ? (label.get(columnFor({ stage: t.contact.stage, setterStage: t.contact.setterStage }, columns)) ?? null) : null,
      // A lead on Lost is done: J's leftover draft isn't work waiting.
      draft: Boolean(t.contact && drafts.has(t.contact.id) && t.contact.stage !== "LOST"),
      note: note(t),
      href: inboxStreamHref(opts.params, t.conversationId),
      current: t.conversationId === opts.selected,
      unread: unreadMark(t),
      starred: t.crm.starred,
      spam: isSpam(t.crm),
      archived: Boolean(t.crm.archivedAt),
    }));
}
