// The broadcast engine (Follow-up Friday):
//   1. Audience: the tag, minus paused / Personal / Pitches / Pause all;
//      inside the 24h window only, the rest "outside window" (audience.ts).
//   2. Run: created when Kevin saves this week's link.
//   3. Personalisation: J writes each message (personalise.ts); the link is
//      its own bubble; near-duplicates are rewritten.
//   4. Review: Kevin approves, edits or leaves out each one.
//   5. Scheduling: approved ones get human times in the window, inside each
//      person's 24h window, under the daily cap (schedule.ts).
//   6. Sending: the os-broadcast-send job (send.ts), through the cap guard.
// Nothing sends without Approve.

import { assignSchedule, hourLabels, humanise, nextRunDate, tickPercents, seededRng, validTime, windowBounds, zonedInstant } from "@/lib/os/broadcasts/schedule";
import { selectAudience, type AudienceResult } from "@/lib/os/broadcasts/audience";
import { enqueueBroadcastSend } from "@/lib/os/broadcasts/jobs";
import { isNearDuplicateOfAny, messageText, personaliseOne, threadState, type DraftWriter } from "@/lib/os/broadcasts/personalise";
import { broadcastStore, type BroadcastStore } from "@/lib/os/broadcasts/store";
import { cleanLink, splitLines, textBubbles, withLinkBubble } from "@/lib/os/broadcasts/template";
import type { BroadcastContact, BroadcastMessageView, BroadcastRunView, BroadcastView } from "@/lib/os/broadcasts/types";
import { capState } from "@/lib/os/sending/cap";
import { getSetterConfig } from "@/lib/os/setter/config";

export interface EngineDeps {
  store?: BroadcastStore;
  now?: Date;
  /** J for one contact; null = the deterministic writer. */
  writerFor?: (workspaceId: string, contactId: string) => Promise<DraftWriter | null>;
  /** Pause all + cap; defaults read OsWorkspace / OsEvent. */
  cap?: (workspaceId: string, now: Date) => Promise<{ sentToday: number; cap: number; pausedAll: boolean }>;
  enqueue?: typeof enqueueBroadcastSend;
  /** The last lines of a thread for J; defaults to the setter store. */
  recent?: (workspaceId: string, contactId: string) => Promise<string[]>;
}

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ctx(d: EngineDeps) {
  return {
    store: d.store ?? broadcastStore(),
    now: d.now ?? new Date(),
    writerFor: d.writerFor ?? defaultWriterFor,
    cap: d.cap ?? (async (w: string, now: Date) => capState(w, { now })),
    enqueue: d.enqueue ?? enqueueBroadcastSend,
    recent: d.recent ?? recentLines,
  };
}

/** J's own system prompt, in broadcast mode. Null when the drafter is the fake. */
async function defaultWriterFor(workspaceId: string, contactId: string): Promise<DraftWriter | null> {
  const cfg = getSetterConfig();
  if (cfg.drafter.backend === "fake") return null;
  try {
    const [{ setterStore }, { dbKnowledge }, { loadMethod }, { systemPrompt }, { draft }] = await Promise.all([
      import("@/lib/os/setter/store"),
      import("@/lib/os/setter/setters"),
      import("@/lib/os/setter/knowledge"),
      import("@/lib/os/setter/prompt"),
      import("@/lib/os/setter/drafter"),
    ]);
    const contact = await setterStore().getContact(contactId, workspaceId);
    if (!contact) return null;
    const setter = await dbKnowledge.forContact(contact);
    const system = systemPrompt(loadMethod(), setter.profile, setter.offered, new Date().toISOString().slice(0, 10));
    return async (prompt) => (await draft({ system, prompt, job: "draft", settings: cfg.drafter })).obj;
  } catch (err) {
    console.error("[OS Broadcasts] J unavailable, using the template:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** The last lines of their thread for J ("THEM: …", "US: …"). */
async function recentLines(workspaceId: string, contactId: string): Promise<string[]> {
  try {
    const { setterStore } = await import("@/lib/os/setter/store");
    const s = setterStore();
    const contact = await s.getContact(contactId, workspaceId);
    if (!contact) return [];
    const msgs = await s.readThread(contact);
    return msgs.slice(-8).map((m) => `${m.incoming ? "THEM" : "US"}: ${m.text.replace(/\s+/g, " ").slice(0, 240)}`);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- read

export interface BuilderMessage extends BroadcastMessageView {
  handle: string;
  initial: string;
  /** "Live · Qualify", "Quiet 20h · Value". */
  context: string;
  /** Text bubbles (the link bubble is shown on its own). */
  text: string[];
}

export interface BuilderData {
  broadcast: BroadcastView;
  runDate: string;
  runToday: boolean;
  /** "Fri 23 Oct, 10:00–15:00" */
  windowLabel: string;
  windowStartIso: string;
  windowEndIso: string;
  run: BroadcastRunView | null;
  audience: {
    /** Tagged and not excluded. */
    count: number;
    handles: { contactId: string; handle: string }[];
    outside: { contactId: string; handle: string; reason: string | null }[];
    excluded: { contactId: string; handle: string; reason: string | null }[];
    eligible: number;
  };
  messages: BuilderMessage[];
  cap: { sentToday: number; cap: number; pausedAll: boolean };
  /** Planned (or previewed) send times, ms. */
  times: number[];
  /** The pacing strip: tick positions (%) and hour labels. */
  ticks: number[];
  hours: string[];
}

function handleOf(c: Pick<BroadcastContact, "username" | "fullName" | "contactId">): string {
  return c.username ?? c.fullName ?? c.contactId;
}

export function windowLabel(runDate: string, b: Pick<BroadcastView, "windowStart" | "windowEnd" | "timezone">): string {
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: b.timezone }).format(zonedInstant(runDate, "12:00", b.timezone));
  return `${day.replace(",", "")}, ${b.windowStart}–${b.windowEnd}`;
}

async function audienceFor(store: BroadcastStore, workspaceId: string, b: BroadcastView, runDate: string, now: Date, pausedAll: boolean): Promise<{ result: AudienceResult; contacts: BroadcastContact[] }> {
  const { start, end } = windowBounds(runDate, b.windowStart, b.windowEnd, b.timezone);
  const contacts = await store.taggedContacts(workspaceId, b.audienceTag);
  const from = new Date(Math.max(start.getTime(), now.getTime()));
  return { result: selectAudience(contacts, { tag: b.audienceTag, from, until: end, pausedAll, cfg: getSetterConfig() }), contacts };
}

export async function loadBuilder(workspaceId: string, key: string, deps: EngineDeps = {}): Promise<BuilderData | null> {
  const { store, now, cap } = ctx(deps);
  const b = await store.get(workspaceId, key);
  if (!b) return null;
  const next = nextRunDate(b.windowDay, b.windowEnd, b.timezone, now);
  const [run, capNow] = await Promise.all([store.getRun(b.id, next.date), cap(workspaceId, now)]);
  const { result, contacts } = await audienceFor(store, workspaceId, b, next.date, now, false);
  const byId = new Map(contacts.map((c) => [c.contactId, c]));
  const { start, end } = windowBounds(next.date, b.windowStart, b.windowEnd, b.timezone);
  const msgs = run ? await store.messages(run.id) : [];

  const messages: BuilderMessage[] = msgs.flatMap((m) => {
    const c = byId.get(m.contactId);
    if (!c) return [];
    const at = m.scheduledAt ? new Date(m.scheduledAt) : start;
    return [{ ...m, handle: handleOf(c), initial: handleOf(c)[0]?.toUpperCase() ?? "?", context: threadState(c, at).label, text: textBubbles(m.bubbles, run?.link ?? null) }];
  });

  let times = messages.filter((m) => m.scheduledAt && m.status !== "skipped" && m.status !== "outside_window").map((m) => new Date(m.scheduledAt!).getTime());
  if (!times.length && result.eligible.length) {
    // A preview of the pacing before any draft exists.
    times = assignSchedule(
      result.eligible.map((e) => ({ id: e.contact.contactId, bubbles: 0, deadline: e.deadline ? new Date(e.deadline).getTime() : null })),
      { start, end, tz: b.timezone, rng: seededRng(`${b.id}:${next.date}`), capLeft: Infinity, now }
    ).flatMap((o) => (o.status === "scheduled" ? [o.at] : []));
  }

  return {
    broadcast: b,
    runDate: next.date,
    runToday: next.today,
    windowLabel: windowLabel(next.date, b),
    windowStartIso: start.toISOString(),
    windowEndIso: end.toISOString(),
    run,
    audience: {
      count: result.eligible.length + result.outside.length,
      handles: [...result.eligible, ...result.outside].map((e) => ({ contactId: e.contact.contactId, handle: handleOf(e.contact) })),
      outside: result.outside.map((e) => ({ contactId: e.contact.contactId, handle: handleOf(e.contact), reason: e.reason })),
      excluded: result.excluded.map((e) => ({ contactId: e.contact.contactId, handle: handleOf(e.contact), reason: e.reason })),
      eligible: result.eligible.length,
    },
    messages,
    cap: { sentToday: capNow.sentToday, cap: capNow.cap, pausedAll: capNow.pausedAll },
    times: times.sort((x, y) => x - y),
    ticks: tickPercents(times, start, end),
    hours: hourLabels(b.windowStart, b.windowEnd),
  };
}

// ---------------------------------------------------------------- settings

export interface BroadcastInput {
  link?: string | null;
  template?: string;
  followupOn?: boolean;
  followupTemplate?: string | null;
  followupDelayMin?: number;
  windowDay?: number;
  windowStart?: string;
  windowEnd?: string;
  enabled?: boolean;
}

/** Check a form; returns the patch or what's wrong. */
export function validateInput(i: BroadcastInput): { patch: Partial<BroadcastView>; link: string | null | undefined } | { error: string } {
  const patch: Partial<BroadcastView> = {};
  let link: string | null | undefined;
  if (i.link !== undefined) {
    if (i.link === null || !String(i.link).trim()) link = null;
    else {
      link = cleanLink(String(i.link));
      if (!link) return { error: "That link doesn't look right. Paste the full URL." };
    }
    patch.link = link;
  }
  if (i.template !== undefined) {
    const t = String(i.template).trim();
    if (!t) return { error: "The message can't be empty." };
    if (t.length > 1000) return { error: "Keep the message under 1000 characters." };
    patch.template = t;
  }
  if (i.followupOn !== undefined || i.followupTemplate !== undefined) {
    const t = (i.followupTemplate ?? "").trim();
    patch.followupTemplate = i.followupOn === false || !t ? null : t.slice(0, 500);
  }
  if (i.followupDelayMin !== undefined) {
    const n = Number(i.followupDelayMin);
    if (n !== 5 && n !== 60) return { error: "Pick a follow-up delay." };
    patch.followupDelayMin = n;
  }
  if (i.windowDay !== undefined) {
    const n = Number(i.windowDay);
    if (!Number.isInteger(n) || n < 0 || n > 6) return { error: "Pick a day." };
    patch.windowDay = n;
  }
  const s = i.windowStart ?? null;
  const e = i.windowEnd ?? null;
  if (s !== null && !validTime(s)) return { error: "Start time looks wrong (HH:MM)." };
  if (e !== null && !validTime(e)) return { error: "End time looks wrong (HH:MM)." };
  if (s !== null) patch.windowStart = s.padStart(5, "0");
  if (e !== null) patch.windowEnd = e.padStart(5, "0");
  if (i.enabled !== undefined) patch.enabled = Boolean(i.enabled);
  return { patch, link };
}

/**
 * Save the builder. A pasted link starts (or updates) this week's run and J
 * drafts everyone in the window. A changed link swaps the link bubble of
 * every message not yet sent.
 */
export async function saveBroadcast(workspaceId: string, key: string, input: BroadcastInput, deps: EngineDeps = {}): Promise<Result<{ drafted: number }>> {
  const c = ctx(deps);
  const b = await c.store.get(workspaceId, key);
  if (!b) return { ok: false, error: "Broadcast not found." };
  const v = validateInput(input);
  if ("error" in v) return { ok: false, error: v.error };
  const s = v.patch.windowStart ?? b.windowStart;
  const e = v.patch.windowEnd ?? b.windowEnd;
  if (s >= e) return { ok: false, error: "The window has to end after it starts." };
  const updated = await c.store.update(workspaceId, b.id, v.patch);
  if (!updated.link) return { ok: true, drafted: 0 };

  const next = nextRunDate(updated.windowDay, updated.windowEnd, updated.timezone, c.now);
  const existing = await c.store.getRun(updated.id, next.date);
  if (existing && existing.link === updated.link) return { ok: true, drafted: 0 };
  const run = await c.store.createRun(updated.id, next.date, updated.link);
  if (existing && existing.link !== updated.link) {
    for (const m of await c.store.messages(run.id)) {
      if (m.status === "sent" || m.status === "failed") continue;
      await c.store.updateMessage(m.id, { bubbles: withLinkBubble(textBubbles(m.bubbles, existing.link), updated.link) });
    }
  }
  const r = await draftRun(workspaceId, updated, run, {}, deps);
  return r.ok ? { ok: true, drafted: r.drafted } : r;
}

// ---------------------------------------------------------------- drafting

/**
 * J drafts the run. Keeps what Kevin already touched (approved, edited,
 * scheduled, sent, left out) unless `regenerate` names it. People outside the
 * window get an "outside_window" row; people who left the audience are left out.
 */
export async function draftRun(
  workspaceId: string,
  b: BroadcastView,
  run: BroadcastRunView,
  opts: { regenerate?: string[] },
  deps: EngineDeps = {}
): Promise<Result<{ drafted: number }>> {
  const c = ctx(deps);
  const capNow = await c.cap(workspaceId, c.now);
  const { result } = await audienceFor(c.store, workspaceId, b, run.runDate, c.now, capNow.pausedAll);
  const { start, end } = windowBounds(run.runDate, b.windowStart, b.windowEnd, b.timezone);
  const current = new Map((await c.store.messages(run.id)).map((m) => [m.contactId, m]));
  const regen = new Set(opts.regenerate ?? []);
  const touched = (m: BroadcastMessageView | undefined) =>
    Boolean(m) && (m!.status === "sent" || m!.status === "failed" || m!.status === "skipped" || m!.status === "approved" || m!.status === "scheduled" || m!.edited);

  // People who are no longer in the audience: leave their open drafts out.
  const inAudience = new Set([...result.eligible, ...result.outside].map((e) => e.contact.contactId));
  for (const m of current.values()) {
    if (!inAudience.has(m.contactId) && (m.status === "drafted" || m.status === "approved")) await c.store.updateMessage(m.id, { status: "skipped", error: "Left the audience" });
  }
  for (const e of result.outside) {
    const m = current.get(e.contact.contactId);
    if (m && (m.status === "sent" || m.status === "scheduled" || m.status === "skipped")) continue;
    await c.store.upsertMessage(run.id, workspaceId, e.contact.contactId, { status: "outside_window", error: e.reason, bubbles: [], followupBubbles: [], scheduledAt: null });
  }

  // Planned times (a preview until Schedule; Kevin can move them).
  const plan = assignSchedule(
    result.eligible.map((e) => ({ id: e.contact.contactId, bubbles: 0, deadline: e.deadline ? new Date(e.deadline).getTime() : null })),
    { start, end, tz: b.timezone, rng: seededRng(`${run.id}:${c.now.getTime()}`), capLeft: Infinity, now: c.now }
  );
  const planned = new Map(plan.map((p) => [p.id, p]));

  // Every message already written counts as taken: nobody gets a twin.
  const keeps = (m: BroadcastMessageView | undefined): m is BroadcastMessageView =>
    Boolean(m) && !regen.has(m!.id) && (touched(m) || (m!.status === "drafted" && m!.bubbles.length > 0));
  const taken: string[] = [...current.values()]
    .filter((m) => keeps(m) && m.status !== "skipped" && m.status !== "outside_window" && m.bubbles.length > 0)
    .map((m) => messageText(textBubbles(m.bubbles, run.link), m.followupBubbles));

  let drafted = 0;
  let k = 0;
  for (const e of result.eligible) {
    if (keeps(current.get(e.contact.contactId))) continue;
    const p = planned.get(e.contact.contactId);
    if (p?.status !== "scheduled") {
      await c.store.upsertMessage(run.id, workspaceId, e.contact.contactId, { status: "outside_window", error: "Their 24h window closes before the send.", bubbles: [], followupBubbles: [], scheduledAt: null });
      continue;
    }
    const at = new Date(p.at);
    const write = await c.writerFor(workspaceId, e.contact.contactId);
    const msg = await personaliseOne(
      {
        contact: e.contact,
        template: b.template,
        followupTemplate: b.followupTemplate,
        link: run.link ?? "",
        at,
        recent: await c.recent(workspaceId, e.contact.contactId),
        avoid: taken.slice(-12),
        name: b.name,
      },
      taken,
      write,
      k++
    );
    taken.push(messageText(textBubbles(msg.bubbles, run.link), msg.followupBubbles));
    await c.store.upsertMessage(run.id, workspaceId, e.contact.contactId, {
      bubbles: msg.bubbles,
      followupBubbles: msg.followupBubbles,
      status: "drafted",
      edited: false,
      scheduledAt: at.toISOString(),
      error: null,
      reasoning: msg.reasoning,
    });
    drafted++;
  }
  await c.store.updateRun(run.id, { status: run.status === "scheduled" ? "scheduled" : "review" });
  return { ok: true, drafted };
}

async function messageInRun(store: BroadcastStore, workspaceId: string, messageId: string) {
  const m = await store.getMessage(messageId);
  if (!m || m.workspaceId !== workspaceId) return null;
  const run = await store.getRunById(m.runId);
  if (!run) return null;
  const b = await store.getById(run.broadcastId);
  if (!b || b.workspaceId !== workspaceId) return null;
  return { m, run, b };
}

/** Regenerate one draft, or every untouched one (Regenerate all re-checks the audience too). */
export async function regenerate(workspaceId: string, key: string, messageId: string | null, deps: EngineDeps = {}): Promise<Result<{ drafted: number }>> {
  const c = ctx(deps);
  const b = await c.store.get(workspaceId, key);
  if (!b) return { ok: false, error: "Broadcast not found." };
  const next = nextRunDate(b.windowDay, b.windowEnd, b.timezone, c.now);
  const run = await c.store.getRun(b.id, next.date);
  if (!run) return { ok: false, error: "Paste this week's link first." };
  if (messageId) {
    const found = await messageInRun(c.store, workspaceId, messageId);
    if (!found || found.run.id !== run.id) return { ok: false, error: "That draft is gone. Refresh." };
    if (found.m.status === "sent" || found.m.status === "scheduled") return { ok: false, error: "Already on its way; unschedule it first." };
    return draftRun(workspaceId, b, run, { regenerate: [messageId] }, deps);
  }
  const drafted = (await c.store.messages(run.id)).filter((m) => m.status === "drafted" && !m.edited).map((m) => m.id);
  return draftRun(workspaceId, b, run, { regenerate: drafted }, deps);
}

// ---------------------------------------------------------------- review

/** Kevin's words: one bubble per line, the link added back on its own. */
export async function editMessage(workspaceId: string, messageId: string, input: { text?: string; followup?: string }, deps: EngineDeps = {}): Promise<Result> {
  const c = ctx(deps);
  const found = await messageInRun(c.store, workspaceId, messageId);
  if (!found) return { ok: false, error: "That draft is gone. Refresh." };
  const { m, run } = found;
  if (m.status === "sent") return { ok: false, error: "Already sent." };
  const text = input.text !== undefined ? splitLines(input.text) : textBubbles(m.bubbles, run.link);
  if (!text.length) return { ok: false, error: "Write something, or leave them out." };
  const followup = input.followup !== undefined ? splitLines(input.followup) : m.followupBubbles;
  const bubbles = withLinkBubble(text, run.link);
  const others = (await c.store.messages(run.id))
    .filter((x) => x.id !== m.id && x.status !== "skipped" && x.status !== "outside_window" && x.bubbles.length)
    .map((x) => messageText(textBubbles(x.bubbles, run.link), x.followupBubbles));
  if (isNearDuplicateOfAny(messageText(textBubbles(bubbles, run.link), followup), others)) {
    return { ok: false, error: "Too close to another message in this send. Change a few words." };
  }
  // An edit needs a fresh approve; a scheduled one comes off the schedule.
  await c.store.updateMessage(m.id, { bubbles, followupBubbles: followup, edited: true, status: "drafted", error: null });
  return { ok: true };
}

export async function approveMessage(workspaceId: string, messageId: string, deps: EngineDeps = {}): Promise<Result> {
  const c = ctx(deps);
  const found = await messageInRun(c.store, workspaceId, messageId);
  if (!found) return { ok: false, error: "That draft is gone. Refresh." };
  if (found.m.status !== "drafted") return { ok: false, error: "Only a draft can be approved." };
  if (!found.m.bubbles.length) return { ok: false, error: "Nothing to send." };
  await c.store.updateMessage(found.m.id, { status: "approved", error: null });
  return { ok: true };
}

/** Back to a draft (undo approve / unschedule). */
export async function unapproveMessage(workspaceId: string, messageId: string, deps: EngineDeps = {}): Promise<Result> {
  const c = ctx(deps);
  const found = await messageInRun(c.store, workspaceId, messageId);
  if (!found) return { ok: false, error: "That draft is gone. Refresh." };
  if (found.m.status !== "approved" && found.m.status !== "scheduled") return { ok: false, error: "Nothing to undo." };
  await c.store.updateMessage(found.m.id, { status: "drafted" });
  return { ok: true };
}

/** Leave out / put back. */
export async function skipMessage(workspaceId: string, messageId: string, skip: boolean, deps: EngineDeps = {}): Promise<Result> {
  const c = ctx(deps);
  const found = await messageInRun(c.store, workspaceId, messageId);
  if (!found) return { ok: false, error: "That message is gone. Refresh." };
  if (found.m.status === "sent") return { ok: false, error: "Already sent." };
  if (skip) await c.store.updateMessage(found.m.id, { status: "skipped", error: null });
  else await c.store.updateMessage(found.m.id, { status: found.m.bubbles.length ? "drafted" : "outside_window" });
  return { ok: true };
}

/** Move one send. Typed times are nudged off the minute. */
export async function setMessageTime(workspaceId: string, messageId: string, hhmm: string, deps: EngineDeps = {}): Promise<Result<{ at: string }>> {
  const c = ctx(deps);
  const found = await messageInRun(c.store, workspaceId, messageId);
  if (!found) return { ok: false, error: "That draft is gone. Refresh." };
  const { m, run, b } = found;
  if (m.status === "sent") return { ok: false, error: "Already sent." };
  if (!validTime(hhmm)) return { ok: false, error: "Use HH:MM." };
  const { start, end } = windowBounds(run.runDate, b.windowStart, b.windowEnd, b.timezone);
  const at = humanise(zonedInstant(run.runDate, hhmm, b.timezone).getTime(), b.timezone, seededRng(`${m.id}:${hhmm}`));
  if (at < start.getTime() || at >= end.getTime()) return { ok: false, error: `Keep it inside ${b.windowStart}–${b.windowEnd}.` };
  const contact = await c.store.contact(workspaceId, m.contactId);
  const { stillInWindow } = await import("@/lib/os/broadcasts/audience");
  if (contact && !stillInWindow(contact.theirLastAt, new Date(at), getSetterConfig())) return { ok: false, error: "Their 24h window is closed by then. Pick an earlier time." };
  // Moving a scheduled one takes it off the schedule until Schedule runs again.
  await c.store.updateMessage(m.id, { scheduledAt: new Date(at).toISOString(), status: m.status === "scheduled" ? "approved" : m.status });
  return { ok: true, at: new Date(at).toISOString() };
}

// ---------------------------------------------------------------- scheduling

/**
 * Schedule every approved message. Planned times are kept when still good
 * (inside the window, in the future, inside their 24h window, off the minute);
 * the rest get fresh times. The daily cap holds back what would pass it.
 */
export async function scheduleRun(workspaceId: string, key: string, deps: EngineDeps = {}): Promise<Result<{ scheduled: number; capped: number; outside: number; queued: boolean }>> {
  const c = ctx(deps);
  const b = await c.store.get(workspaceId, key);
  if (!b) return { ok: false, error: "Broadcast not found." };
  const next = nextRunDate(b.windowDay, b.windowEnd, b.timezone, c.now);
  const run = await c.store.getRun(b.id, next.date);
  if (!run) return { ok: false, error: "Paste this week's link first." };
  const capNow = await c.cap(workspaceId, c.now);
  if (capNow.pausedAll) return { ok: false, error: "Pause all is on. Nothing was scheduled." };

  const { start, end } = windowBounds(run.runDate, b.windowStart, b.windowEnd, b.timezone);
  const all = await c.store.messages(run.id);
  const approved = all.filter((m) => m.status === "approved");
  if (!approved.length) return { ok: false, error: "Approve at least one message first." };

  const already = all.filter((m) => m.status === "scheduled").reduce((n, m) => n + m.bubbles.length + m.followupBubbles.length, 0);
  const capLeft = (next.today ? Math.max(0, capNow.cap - capNow.sentToday) : capNow.cap) - already;

  const contacts = new Map((await Promise.all(approved.map((m) => c.store.contact(workspaceId, m.contactId)))).flatMap((x) => (x ? [[x.contactId, x] as const] : [])));
  const { windowState } = await import("@/lib/os/setter/state");
  const deadlineOf = (contactId: string): number | null => {
    const ct = contacts.get(contactId);
    if (!ct) return null;
    const [st, until] = windowState(ct.theirLastAt, new Date(Math.max(start.getTime(), c.now.getTime())), getSetterConfig());
    return st === "free" && until ? Math.min(new Date(until).getTime(), end.getTime()) : 0;
  };
  const { onTheMinute } = await import("@/lib/os/broadcasts/schedule");
  const good = (m: BroadcastMessageView) => {
    if (!m.scheduledAt) return false;
    const t = new Date(m.scheduledAt).getTime();
    const dl = deadlineOf(m.contactId);
    return t >= Math.max(start.getTime(), c.now.getTime() + 60_000) && t < end.getTime() && (dl === null || t < dl) && !onTheMinute(t, b.timezone);
  };

  // Keep good times; re-plan the rest; then apply the cap in send order.
  const keep = approved.filter(good);
  const replan = approved.filter((m) => !good(m));
  const plan = assignSchedule(
    replan.map((m) => ({ id: m.id, bubbles: 0, deadline: deadlineOf(m.contactId) })),
    { start, end, tz: b.timezone, rng: seededRng(`${run.id}:sched:${c.now.getTime()}`), capLeft: Infinity, now: c.now }
  );
  const timeOf = new Map<string, number>(keep.map((m) => [m.id, new Date(m.scheduledAt!).getTime()]));
  let outside = 0;
  for (const p of plan) {
    if (p.status === "scheduled") timeOf.set(p.id, p.at);
    else {
      outside++;
      await c.store.updateMessage(p.id, { status: "outside_window", error: p.reason, scheduledAt: null });
    }
  }
  const ordered = approved.filter((m) => timeOf.has(m.id)).sort((x, y) => timeOf.get(x.id)! - timeOf.get(y.id)!);
  let used = 0;
  let scheduled = 0;
  let capped = 0;
  let queued = true;
  for (const m of ordered) {
    const n = m.bubbles.length + m.followupBubbles.length;
    const at = timeOf.get(m.id)!;
    if (used + n > capLeft) {
      capped++;
      await c.store.updateMessage(m.id, { error: "Over the daily send cap", scheduledAt: new Date(at).toISOString() });
      continue;
    }
    used += n;
    await c.store.updateMessage(m.id, { status: "scheduled", scheduledAt: new Date(at).toISOString(), error: null });
    queued = (await c.enqueue({ messageId: m.id, part: "main" }, at)) && queued;
    scheduled++;
  }
  if (scheduled) await c.store.updateRun(run.id, { status: "scheduled" });
  return { ok: true, scheduled, capped, outside, queued };
}

// ---------------------------------------------------------------- audience edits

export async function setInAudience(workspaceId: string, key: string, contactId: string, on: boolean, deps: EngineDeps = {}): Promise<Result> {
  const c = ctx(deps);
  const b = await c.store.get(workspaceId, key);
  if (!b) return { ok: false, error: "Broadcast not found." };
  await c.store.setTag(workspaceId, contactId, b.audienceTag, on);
  if (!on) {
    const next = nextRunDate(b.windowDay, b.windowEnd, b.timezone, c.now);
    const run = await c.store.getRun(b.id, next.date);
    const m = run ? (await c.store.messages(run.id)).find((x) => x.contactId === contactId) : null;
    if (m && m.status !== "sent") await c.store.updateMessage(m.id, { status: "skipped", error: "Left the audience" });
  }
  return { ok: true };
}

// ---------------------------------------------------------------- what needs Kevin

export interface BroadcastNeed {
  key: string;
  name: string;
  runDate: string;
  today: boolean;
  /** "link": paste this week's link; "review": drafts waiting. */
  kind: "link" | "review";
  /** Drafts waiting (review) or people inside the window (link). */
  count: number;
  windowStart: string;
  /** "Fri" */
  day: string;
  href: string;
}

/** Yours to do: a broadcast with no link for its next run, or drafts to review. */
export async function broadcastNeeds(workspaceId: string, deps: EngineDeps = {}): Promise<BroadcastNeed[]> {
  const c = ctx(deps);
  const out: BroadcastNeed[] = [];
  for (const b of await c.store.list(workspaceId)) {
    if (!b.enabled) continue;
    const next = nextRunDate(b.windowDay, b.windowEnd, b.timezone, c.now);
    const run = await c.store.getRun(b.id, next.date);
    const base = { key: b.key, name: b.name, runDate: next.date, today: next.today, windowStart: b.windowStart, day: DOW[b.windowDay], href: `/os/automations/broadcasts/${b.key}` };
    if (!run) {
      const { result } = await audienceFor(c.store, workspaceId, b, next.date, c.now, false);
      out.push({ ...base, kind: "link", count: result.eligible.length + result.outside.length });
      continue;
    }
    const drafts = (await c.store.messages(run.id)).filter((m) => m.status === "drafted").length;
    if (drafts) out.push({ ...base, kind: "review", count: drafts });
  }
  return out;
}

// ---------------------------------------------------------------- the list

export interface BroadcastListItem {
  key: string;
  name: string;
  audienceTag: string;
  audience: number;
  enabled: boolean;
  windowLabel: string;
  /** "Needs link", "4 to review", "6 scheduled", "Sent 6" */
  state: string;
  needs: boolean;
}

export async function loadBroadcastList(workspaceId: string, deps: EngineDeps = {}): Promise<BroadcastListItem[]> {
  const c = ctx(deps);
  const out: BroadcastListItem[] = [];
  for (const b of await c.store.list(workspaceId)) {
    const next = nextRunDate(b.windowDay, b.windowEnd, b.timezone, c.now);
    const run = await c.store.getRun(b.id, next.date);
    const { result } = await audienceFor(c.store, workspaceId, b, next.date, c.now, false);
    const msgs = run ? await c.store.messages(run.id) : [];
    const n = (s: string) => msgs.filter((m) => m.status === s).length;
    const state = !run ? "Needs link" : n("drafted") ? `${n("drafted")} to review` : n("scheduled") ? `${n("scheduled")} scheduled` : n("sent") ? `Sent ${n("sent")}` : "Ready";
    out.push({
      key: b.key,
      name: b.name,
      audienceTag: b.audienceTag,
      audience: result.eligible.length + result.outside.length,
      enabled: b.enabled,
      windowLabel: windowLabel(next.date, b),
      state,
      needs: b.enabled && (!run || n("drafted") > 0),
    });
  }
  return out;
}
