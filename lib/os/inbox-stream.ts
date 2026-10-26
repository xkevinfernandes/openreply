// The inbox as one newest-first stream (dm-crm issues 009, 011, 012): unread,
// starred, archive, spam, drafts waiting, window closing and the composer's
// window display. Pure, so it is tested (__tests__/os/inbox-stream.test.ts);
// the loader is lib/os/inbox-stream-load.ts.
//
// These fields only drive what Kevin sees. The setter record stays the one
// source for every send decision (J, sequences, workflows, broadcasts).

import type { ContactKind } from "@/app/generated/prisma/enums";
import type { InboxThread } from "@/lib/os/inbox";
import { isSpam } from "@/lib/os/spam";

/** The CRM fields of a thread's contact (ISO strings: they cross to the client). */
export interface ThreadCrm {
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  lastOpenedAt: string | null;
  lastPersonalSendAt: string | null;
  starred: boolean;
  spam: boolean;
  spamOverride: boolean | null;
  archivedAt: string | null;
}

export const EMPTY_CRM: ThreadCrm = {
  lastInboundAt: null,
  lastOutboundAt: null,
  lastOpenedAt: null,
  lastPersonalSendAt: null,
  starred: false,
  spam: false,
  spamOverride: null,
  archivedAt: null,
};

export type StreamThread = InboxThread & { crm: ThreadCrm };

// --- Filters --------------------------------------------------------------------

export type StatusFilter = "unread" | "all" | "recent" | "starred" | "drafts" | "closing" | "spam" | "archived";

/** Kevin's order: Unread, All, Recent, Starred first, then the rest. */
export const STATUS_FILTERS: { key: StatusFilter; label: string; tip?: string }[] = [
  { key: "unread", label: "Unread", tip: "Replies you type in the Instagram app don't mark a thread read." },
  { key: "all", label: "All" },
  { key: "recent", label: "Recent", tip: "A message in the last 7 days." },
  { key: "starred", label: "Starred" },
  { key: "drafts", label: "Drafts waiting" },
  { key: "closing", label: "Window closing", tip: "They wrote last and their 24-hour window ends within 4 hours. Replies typed in the Instagram app can't be seen." },
  { key: "spam", label: "Spam" },
  { key: "archived", label: "Archived" },
];

export type CategoryFilter = "any" | "sales" | "personal" | "pitches" | "unsorted";

export const CATEGORY_FILTERS: { key: CategoryFilter; label: string; kind: ContactKind | null }[] = [
  { key: "any", label: "Any", kind: null },
  { key: "sales", label: "Sales", kind: "SALES" },
  { key: "personal", label: "Personal", kind: "PERSONAL" },
  { key: "pitches", label: "Pitches", kind: "PITCHES" },
  { key: "unsorted", label: "Unsorted", kind: "UNSORTED" },
];

const HOUR = 3600_000;
export const RECENT_MS = 7 * 24 * HOUR;
export const CLOSING_MS = 4 * HOUR;
export const FREE_WINDOW_MS = 24 * HOUR;
export const HUMAN_AGENT_MS = 7 * 24 * HOUR;

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);

/** Unread = their last inbound later than Kevin's last open, or never opened.
 *  Comment-only contacts (no inbound DM) are never unread. */
export function isUnread(crm: Pick<ThreadCrm, "lastInboundAt" | "lastOpenedAt">): boolean {
  if (!crm.lastInboundAt) return false;
  if (!crm.lastOpenedAt) return true;
  return ms(crm.lastInboundAt) > ms(crm.lastOpenedAt);
}

/** They wrote last (inbound newer than our last outbound). */
export function theyWroteLast(crm: Pick<ThreadCrm, "lastInboundAt" | "lastOutboundAt">): boolean {
  if (!crm.lastInboundAt) return false;
  return !crm.lastOutboundAt || ms(crm.lastInboundAt) > ms(crm.lastOutboundAt);
}

/** Window closing: they wrote last and the 24-hour window ends within 4 hours
 *  (still open). */
export function windowClosing(crm: Pick<ThreadCrm, "lastInboundAt" | "lastOutboundAt">, now: number): boolean {
  if (!theyWroteLast(crm)) return false;
  const left = ms(crm.lastInboundAt) + FREE_WINDOW_MS - now;
  return left > 0 && left <= CLOSING_MS;
}

export interface FilterContext {
  now: number;
  /** Contacts with one of J's reply drafts waiting. */
  draftContactIds: ReadonlySet<string>;
}

const hidden = (t: StreamThread) => isSpam(t.crm) || Boolean(t.crm.archivedAt);

/** Does a thread belong under a status filter? Spam and archived threads are
 *  only under their own filters. */
export function matchesStatus(t: StreamThread, f: StatusFilter, ctx: FilterContext): boolean {
  if (f === "spam") return isSpam(t.crm) && !t.crm.archivedAt;
  if (f === "archived") return Boolean(t.crm.archivedAt);
  if (hidden(t)) return false;
  switch (f) {
    case "all":
      return true;
    case "unread":
      return isUnread(t.crm);
    case "recent":
      return ctx.now - ms(t.updatedTime ?? t.crm.lastInboundAt) <= RECENT_MS;
    case "starred":
      return t.crm.starred;
    case "drafts":
      return Boolean(t.contact && ctx.draftContactIds.has(t.contact.id));
    case "closing":
      return windowClosing(t.crm, ctx.now);
  }
}

export function matchesCategory(t: StreamThread, cat: CategoryFilter): boolean {
  const kind = CATEGORY_FILTERS.find((c) => c.key === cat)?.kind ?? null;
  return !kind || (t.contact?.kind ?? "UNSORTED") === kind;
}

/** Newest first by the stored last message time. */
export function sortStream<T extends Pick<InboxThread, "updatedTime">>(threads: T[]): T[] {
  return [...threads].sort((a, b) => (ms(b.updatedTime) || 0) - (ms(a.updatedTime) || 0));
}

export function filterStream(threads: StreamThread[], f: StatusFilter, cat: CategoryFilter, ctx: FilterContext): StreamThread[] {
  return sortStream(threads.filter((t) => matchesCategory(t, cat) && matchesStatus(t, f, ctx)));
}

/** Counts per status filter, inside the picked category. */
export function filterCounts(threads: StreamThread[], cat: CategoryFilter, ctx: FilterContext): Record<StatusFilter, number> {
  const inCat = threads.filter((t) => matchesCategory(t, cat));
  return Object.fromEntries(STATUS_FILTERS.map((f) => [f.key, inCat.filter((t) => matchesStatus(t, f.key, ctx)).length])) as Record<StatusFilter, number>;
}

/** The nav badge and Home: drafts waiting, never spam or archived. */
export function draftsWaitingCount(threads: StreamThread[], ctx: FilterContext): number {
  return threads.filter((t) => matchesStatus(t, "drafts", ctx)).length;
}

/** What a row shows for unread: Zernio's count only when local says unread,
 *  else a dot; nothing when read. */
export function unreadMark(t: Pick<StreamThread, "crm" | "unreadCount">): { count: number | null } | null {
  if (!isUnread(t.crm)) return null;
  return { count: t.unreadCount && t.unreadCount > 0 ? t.unreadCount : null };
}

// --- URL ------------------------------------------------------------------------

export interface InboxParams {
  filter: StatusFilter;
  cat: CategoryFilter;
}

const isStatus = (v: unknown): v is StatusFilter => STATUS_FILTERS.some((f) => f.key === v);
const isCategory = (v: unknown): v is CategoryFilter => CATEGORY_FILTERS.some((c) => c.key === v);

/** The filters from the URL. An old tab URL (?tab=sales) lands on the
 *  matching category: `redirect` is where to send it. */
/** Home's inbox card links (?filter=unread|drafts|window): `window` = Window closing. */
const FILTER_ALIASES: Record<string, StatusFilter> = { window: "closing", closing: "closing" };

export function parseInboxParams(p: { tab?: string; f?: string; filter?: string; cat?: string; c?: string; drafts?: string }): InboxParams & { redirect: string | null } {
  // ?drafts=1 (Home's review button) = the Drafts waiting filter.
  const alias = p.filter ? (FILTER_ALIASES[p.filter] ?? (isStatus(p.filter) ? p.filter : null)) : null;
  const filter: StatusFilter = isStatus(p.f) ? p.f : alias ? alias : p.drafts === "1" ? "drafts" : "all";
  if (p.tab !== undefined) {
    const cat = isCategory(p.tab) ? p.tab : "any";
    return { filter, cat, redirect: inboxStreamHref({ filter, cat }, p.c ?? null) };
  }
  return { filter, cat: isCategory(p.cat) ? p.cat : "any", redirect: null };
}

/** "/os/inbox?f=unread&cat=sales&c=m1" (defaults left out). */
export function inboxStreamHref(p: Partial<InboxParams>, conversationId?: string | null): string {
  const q = new URLSearchParams();
  if (p.filter && p.filter !== "all") q.set("f", p.filter);
  if (p.cat && p.cat !== "any") q.set("cat", p.cat);
  if (conversationId) q.set("c", conversationId);
  const s = q.toString();
  return s ? `/os/inbox?${s}` : "/os/inbox";
}

// --- The composer's window display (display only) -------------------------------

export interface WindowDisplay {
  kind: "standard" | "human_agent" | "closed" | "none";
  /** "24-hour window · 5h 12m left" */
  label: string;
  /** "Then human-agent replies until Thu 29 Oct" */
  sub: string | null;
  endsAt: string | null;
}

/** "5h 12m", "3d 4h", "12m". */
export function formatLeft(msLeft: number): string {
  const mins = Math.max(0, Math.floor(msLeft / 60_000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

const dayLabel = (t: number, tz?: string) =>
  new Date(t).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", ...(tz ? { timeZone: tz } : {}) });

/**
 * Which Instagram window a thread is in and the time left: the standard 24
 * hours after their last message, then (Zernio only) the human-agent window up
 * to 7 days. "Closed" only when every window that can still send is past.
 * Display only: it changes nothing about what can be sent.
 */
export function windowDisplay(lastInboundAt: string | null, now: number, opts: { zernio: boolean; tz?: string }): WindowDisplay {
  if (!lastInboundAt) return { kind: "none", label: "They haven't written yet", sub: null, endsAt: null };
  const last = ms(lastInboundAt);
  const freeEnd = last + FREE_WINDOW_MS;
  const haEnd = last + HUMAN_AGENT_MS;
  if (now < freeEnd) {
    return {
      kind: "standard",
      label: `24-hour window · ${formatLeft(freeEnd - now)} left`,
      sub: opts.zernio ? `Then human-agent replies until ${dayLabel(haEnd, opts.tz)}` : null,
      endsAt: new Date(freeEnd).toISOString(),
    };
  }
  if (opts.zernio && now < haEnd) {
    return { kind: "human_agent", label: `Human-agent window · ${formatLeft(haEnd - now)} left`, sub: "Replies by hand only", endsAt: new Date(haEnd).toISOString() };
  }
  return { kind: "closed", label: "Window closed", sub: "They need to write first", endsAt: null };
}

/** The later of two ISO times (either may be missing). */
export function laterIso(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return ms(a) >= ms(b) ? a : b;
}
