// Home's outcome row: Keyword triggers → Conversations started → Lead magnets
// sent → Offers made → Calls booked → Showed → Won, read from the OsEvent log
// over Today / 7d / 30d / 90d (Home uses 7d / 30d / 90d). Pure helpers first (tested), loaders at the bottom.
//
// "Conversations started" is the episode rule: a lead message that comes after
// a setter or opener message, counted once per episode. A bare keyword hit is
// never a conversation (it comes before the opener, and a later message that
// is only a campaign keyword doesn't count either).

import { prisma } from "@/lib/db/client";
import { eventKey, recordEvents, type OsEventInput, type OsEventKind } from "@/lib/os/events";
import { loadWorkflowActivity, withWorkflows, workflowRow, type WorkflowCell } from "@/lib/os/metrics-workflows";
import { localDayStart } from "@/lib/os/sending/cap";
import type { SetterRecord } from "@/lib/os/setter/state";

const DAY = 86400_000;

export type Period = "today" | "7d" | "30d" | "90d";
export const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
];

export function parsePeriod(v: string | null | undefined): Period {
  return v === "today" || v === "30d" || v === "90d" ? v : "7d";
}

/** Home's one period switch: the funnel's 7 / 30 / 90 days, so the tiles and the funnel always cover the same days. */
export type HomePeriod = "7d" | "30d" | "90d";
export const HOME_PERIODS: { key: HomePeriod; label: string; days: 7 | 30 | 90 }[] = [
  { key: "7d", label: "7d", days: 7 },
  { key: "30d", label: "30d", days: 30 },
  { key: "90d", label: "90d", days: 90 },
];
/** Old links (?period=today) land on 7d; no period = 30d, the funnel's default. */
export function parseHomePeriod(v: string | null | undefined): HomePeriod {
  return v === "7d" || v === "90d" ? v : v === "today" ? "7d" : "30d";
}

/** Start of the period: local midnight for Today, else a rolling window. */
export function periodStart(period: Period, now: Date, timezone: string): Date {
  if (period === "today") return localDayStart(now, timezone);
  return new Date(now.getTime() - (period === "7d" ? 7 : period === "30d" ? 30 : 90) * DAY);
}

export const OUTCOME_STEPS: { kind: OsEventKind; label: string }[] = [
  { kind: "keyword_trigger", label: "Keyword triggers" },
  { kind: "conversation_started", label: "Conversations started" },
  { kind: "lead_magnet_sent", label: "Lead magnets sent" },
  { kind: "offer_made", label: "Offers made" },
  { kind: "call_booked", label: "Calls booked" },
  { kind: "showed", label: "Showed" },
  { kind: "won", label: "Won" },
];

export interface OutcomeCell {
  kind: OsEventKind;
  label: string;
  n: number;
  /** % of the step before; null for the first step or when the step before is 0. */
  pct: number | null;
}

/** Pure: counts by kind → the 7 cells with step-over-step %. */
export function outcomeRow(counts: Partial<Record<OsEventKind, number>>): OutcomeCell[] {
  return OUTCOME_STEPS.map((s, i) => {
    const n = counts[s.kind] ?? 0;
    const prev = i === 0 ? null : (counts[OUTCOME_STEPS[i - 1].kind] ?? 0);
    return { kind: s.kind, label: s.label, n, pct: prev ? Math.round((n / prev) * 100) : null };
  });
}

// --- Conversations started (the episode rule) --------------------------------

/** A quiet stretch this long ends an episode; the next exchange is a new one. */
export const EPISODE_GAP_DAYS = 14;

export interface ThreadMessage {
  at: string | Date;
  /** Setter, Kevin or an OpenReply opener. */
  fromUs: boolean;
  text?: string | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const ms = (d: string | Date) => (typeof d === "string" ? new Date(d).getTime() : d.getTime());

/** True when the message is nothing but a campaign keyword ("SETTER", "setter!"). */
export function isBareKeyword(text: string | null | undefined, keywords: readonly string[]): boolean {
  const t = norm(text ?? "");
  if (!t) return false;
  return keywords.some((k) => norm(k) === t);
}

/**
 * Pure: the conversation starts in one thread, oldest first. Each returns the
 * episode's start (the first message of that episode) and the lead message
 * that started the conversation. At most one per episode.
 */
export function conversationStarts(messages: ThreadMessage[], keywords: readonly string[] = []): { episodeAt: Date; at: Date }[] {
  const sorted = [...messages].sort((a, b) => ms(a.at) - ms(b.at));
  const out: { episodeAt: Date; at: Date }[] = [];
  let episodeAt: number | null = null;
  let lastAt: number | null = null;
  let weSpoke = false;
  let counted = false;
  for (const m of sorted) {
    const t = ms(m.at);
    if (lastAt === null || t - lastAt >= EPISODE_GAP_DAYS * DAY) {
      episodeAt = t;
      weSpoke = false;
      counted = false;
    }
    lastAt = t;
    if (m.fromUs) {
      weSpoke = true;
      continue;
    }
    if (!weSpoke || counted || isBareKeyword(m.text, keywords)) continue;
    counted = true;
    out.push({ episodeAt: new Date(episodeAt!), at: new Date(t) });
  }
  return out;
}

/** Stable per episode: the day the episode began. */
export function conversationStartedKey(contactId: string, episodeAt: Date): string {
  return eventKey("conversation_started", contactId, episodeAt.toISOString().slice(0, 10));
}

/**
 * Pure: the conversation_started event a SetterRecord stands for, or null.
 * The record has no message texts, so it reads the timestamps: our sends
 * (opener, delivery, J's sends) and their latest text. Bare keyword hits come
 * before the opener, so "after one of ours" already leaves them out.
 */
export function conversationStartFromRecord(
  rec: Pick<SetterRecord, "opener_sent_at" | "delivered_at" | "sends" | "their_last_at" | "last_incoming_text_at" | "our_last_at">,
  ids: { workspaceId: string; contactId: string; setterId?: string | null }
): OsEventInput | null {
  const theirs = rec.last_incoming_text_at ?? rec.their_last_at;
  if (!theirs) return null;
  const outs = [rec.opener_sent_at, rec.delivered_at, rec.our_last_at, ...(rec.sends ?? []).map((s) => s.at)]
    .filter((x): x is string => !!x)
    .map(ms)
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  const theirT = ms(theirs);
  const before = outs.filter((t) => t < theirT);
  if (!before.length) return null;
  // Walk back through our messages to where the episode began.
  let start = before[before.length - 1];
  for (let i = before.length - 2; i >= 0; i--) {
    if (start - before[i] >= EPISODE_GAP_DAYS * DAY) break;
    start = before[i];
  }
  // Their reply came after a long silence from us: a new episode starts with it, not ours.
  if (theirT - before[before.length - 1] >= EPISODE_GAP_DAYS * DAY) return null;
  const episodeAt = new Date(start);
  return {
    workspaceId: ids.workspaceId,
    contactId: ids.contactId,
    setterId: ids.setterId ?? null,
    kind: "conversation_started",
    dedupeKey: conversationStartedKey(ids.contactId, episodeAt),
    at: new Date(theirT),
    data: { episodeAt: episodeAt.toISOString() },
  };
}

// --- Keyword triggers --------------------------------------------------------

export interface DmLogLite {
  id: string;
  workspaceId: string;
  automationId: string;
  matchedKeyword: string | null;
  createdAt: Date;
}

/** Pure: one keyword_trigger per DmLog (a comment or DM that fired a campaign). */
export function keywordTriggerEvents(logs: DmLogLite[]): OsEventInput[] {
  return logs.map((l) => ({
    workspaceId: l.workspaceId,
    kind: "keyword_trigger" as const,
    dedupeKey: eventKey("keyword_trigger", l.id),
    at: l.createdAt,
    data: { automationId: l.automationId, keyword: l.matchedKeyword },
  }));
}

/**
 * Copies recent DmLogs into keyword_trigger events. Upstream OpenReply writes
 * DmLog and we don't hook it, so Home tops the log up when it loads (deduped).
 */
export async function syncKeywordTriggers(workspaceId: string, since: Date): Promise<number> {
  const logs = await prisma.dmLog.findMany({
    where: { workspaceId, createdAt: { gte: since } },
    select: { id: true, workspaceId: true, automationId: true, matchedKeyword: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });
  return recordEvents(keywordTriggerEvents(logs));
}

// --- Loader ------------------------------------------------------------------

export interface HomeOutcomes {
  /** The whole funnel: campaigns (DmLog), J (OsEvent) and workflows. */
  cells: OutcomeCell[];
  /** Workflows on their own; null when the workspace has none. */
  workflows: WorkflowCell[] | null;
}

/** What the sample people would have logged, by when they first wrote. */
export interface SampleOutcomeContact {
  createdAt: Date;
  kind: string;
  spam: boolean;
  spamOverride: boolean | null;
  entryPath: string | null;
  stage: string;
  attendance: "SHOWED" | "NO_SHOW" | null;
  events: ReadonlySet<string>;
}

/**
 * Pure (OS_MOCK): outcome counts from the sample people, so Home's tiles and
 * its funnel count the same people. Every sample entry (keyword, comment,
 * story reply) counts as a trigger and, once they replied, a lead magnet
 * sent; the rest follow their events.
 */
export function sampleOutcomeCounts(contacts: SampleOutcomeContact[], since: Date, now: Date): Partial<Record<OsEventKind, number>> {
  const counts: Partial<Record<OsEventKind, number>> = {};
  const add = (k: OsEventKind) => (counts[k] = (counts[k] ?? 0) + 1);
  for (const c of contacts) {
    if (c.createdAt < since || c.createdAt > now) continue;
    if ((c.spamOverride ?? c.spam) || (c.kind !== "SALES" && c.kind !== "UNSORTED")) continue;
    const triggered = Boolean(c.entryPath);
    if (triggered) add("keyword_trigger");
    if (c.events.has("conversation_started")) add("conversation_started");
    if (triggered && c.events.has("conversation_started")) add("lead_magnet_sent");
    if (c.events.has("offer_made")) add("offer_made");
    if (c.events.has("call_booked")) add("call_booked");
    if (c.events.has("showed") || c.attendance === "SHOWED") add("showed");
    if (c.events.has("won")) add("won");
  }
  return counts;
}

export async function loadOutcomes(workspaceId: string, period: Period, timezone: string, now = new Date()): Promise<HomeOutcomes> {
  const since = periodStart(period, now, timezone);
  const { osMockEnabled } = await import("@/lib/os/mock");
  if (osMockEnabled()) {
    const { loadFunnelContacts } = await import("@/lib/os/crm-funnel");
    return { cells: outcomeRow(sampleOutcomeCounts(await loadFunnelContacts(workspaceId, 90, now), since, now)), workflows: null };
  }
  await syncKeywordTriggers(workspaceId, since).catch((err) => console.error("[OS Metrics] keyword sync:", err instanceof Error ? err.message : err));
  const [rows, started, wf] = await Promise.all([
    prisma.osEvent.groupBy({
      by: ["kind"],
      where: { workspaceId, at: { gte: since, lte: now }, kind: { in: OUTCOME_STEPS.map((s) => s.kind) } },
      _count: { _all: true },
    }),
    prisma.osEvent.findMany({ where: { workspaceId, kind: "conversation_started", at: { gte: since, lte: now }, contactId: { not: null } }, select: { contactId: true } }),
    loadWorkflowActivity(workspaceId, since, now).catch((err) => {
      console.error("[OS Metrics] workflows:", err instanceof Error ? err.message : err);
      return null;
    }),
  ]);
  let counts: Partial<Record<OsEventKind, number>> = {};
  for (const r of rows) counts[r.kind as OsEventKind] = r._count._all;
  if (wf) counts = withWorkflows(counts, wf.activity, { counted: new Set(started.map((e) => e.contactId!)), repliedContacts: wf.repliedContacts });
  return { cells: outcomeRow(counts), workflows: wf?.any ? workflowRow(wf.activity) : null };
}
