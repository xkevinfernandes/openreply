// Read side of follow-ups for the screens: the queue (Follow-ups), the strip
// on a thread (Inbox), "did they show?" and Kevin's voice-note tasks (Home).
// Plain serialisable views; writes are in app/(os)/os/follow-ups/actions.ts.

import { prisma } from "@/lib/db/client";
import { mockThreads, osMockEnabled } from "@/lib/os/mock";
import { getSetterConfig } from "@/lib/os/setter/config";
import { mockBookingRows } from "@/lib/os/setter/booking-store";
import { windowState, type WindowState } from "@/lib/os/setter/state";
import { setterStore, type DraftView } from "@/lib/os/setter/store";
import { planFor } from "@/lib/os/sequences/engine";
import { mockFollowupTick } from "@/lib/os/sequences/mock-seed";
import { preCallTimeline } from "@/lib/os/sequences/plan";
import { sequenceStore, type StepRow, type TaskRow } from "@/lib/os/sequences/store";
import { SEQUENCE_META, isSequenceKey, timingLabel, type SequenceKey } from "@/lib/os/sequences/types";

export interface Person {
  contactId: string;
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  conversationId: string | null;
}

export interface QueuedFollowup extends Person {
  stepId: string;
  sequence: string;
  sequenceTitle: string;
  group: "no_reply" | "booked" | "after_call";
  label: string;
  /** "Step 2 of 4". */
  position: string;
  stepNo: number;
  stepCount: number;
  setterId: string | null;
  timing: string;
  dueAt: string;
  status: "QUEUED" | "DRAFTED";
  intent: string;
  fixedLine: string | null;
  voicePhrase: string | null;
  resource: boolean;
  /** Meta's window at the step's time. */
  window: WindowState;
  draft: Pick<DraftView, "id" | "bubbles" | "flags" | "reasoning" | "humanAgent"> | null;
  /** The call, for before-the-call steps. */
  callAt: string | null;
  callTz: string | null;
}

export interface AttendanceItem extends Person {
  bookingId: string;
  start: string;
  timezone: string;
}

export interface TaskItem extends Person {
  id: string;
  title: string;
  context: TaskRow["context"];
  status: TaskRow["status"];
  createdAt: string;
}

export interface FollowupScreen {
  queue: QueuedFollowup[];
  attendance: AttendanceItem[];
  tasks: TaskItem[];
}

export interface ThreadFollowups {
  live: QueuedFollowup | null;
  /** Why nothing is queued, when nothing is. */
  why: string | null;
  off: boolean;
  /** The other before-the-call steps for their booking, for context. */
  upcoming: { label: string; at: string; dropped: string | null }[];
  attendance: AttendanceItem | null;
  tasks: TaskItem[];
}

const CALL_OVER_MS = 30 * 60_000;

async function people(workspaceId: string, ids: string[]): Promise<Map<string, Person & { theirLastAt: string | null }>> {
  const out = new Map<string, Person & { theirLastAt: string | null }>();
  if (!ids.length) return out;
  if (osMockEnabled()) {
    const store = setterStore();
    for (const t of mockThreads()) {
      if (!t.contact || !ids.includes(t.contact.id)) continue;
      const rec = await store.loadState(t.contact.id);
      out.set(t.contact.id, {
        contactId: t.contact.id,
        username: t.username,
        fullName: t.fullName ?? null,
        avatarUrl: t.avatarUrl ?? null,
        conversationId: t.conversationId,
        theirLastAt: rec?.their_last_at ?? t.updatedTime,
      });
    }
    return out;
  }
  const rows = await prisma.contact.findMany({
    where: { workspaceId, id: { in: ids } },
    select: { id: true, username: true, fullName: true, avatarUrl: true, zernioConversationId: true, setterState: { select: { record: true } } },
  });
  for (const c of rows) {
    const rec = c.setterState?.record as { their_last_at?: string | null } | null;
    out.set(c.id, {
      contactId: c.id,
      username: c.username,
      fullName: c.fullName,
      avatarUrl: c.avatarUrl,
      conversationId: c.zernioConversationId,
      theirLastAt: rec?.their_last_at ?? null,
    });
  }
  return out;
}

async function stepView(
  s: StepRow,
  who: Person & { theirLastAt: string | null },
  drafts: Map<string, DraftView>,
  bookings: Map<string, { start: string; timezone: string }>,
  stepCount: (s: StepRow) => Promise<number>
): Promise<QueuedFollowup> {
  const key = isSequenceKey(s.sequence) ? (s.sequence as SequenceKey) : null;
  const meta = key ? SEQUENCE_META[key] : null;
  const d = s.draftId ? (drafts.get(s.draftId) ?? null) : null;
  const call = s.bookingId ? (bookings.get(s.bookingId) ?? null) : null;
  const [win] = windowState(who.theirLastAt, new Date(Math.max(Date.now(), new Date(s.dueAt).getTime())), getSetterConfig());
  const count = await stepCount(s);
  return {
    contactId: who.contactId,
    username: who.username,
    fullName: who.fullName,
    avatarUrl: who.avatarUrl,
    conversationId: who.conversationId,
    stepId: s.id,
    sequence: s.sequence,
    sequenceTitle: meta?.title ?? s.sequence,
    group: meta?.group ?? "no_reply",
    label: s.step.label,
    position: `Step ${s.stepIndex + 1} of ${count}`,
    stepNo: s.stepIndex + 1,
    stepCount: count,
    setterId: s.setterId,
    timing: timingLabel(s.step.timing),
    dueAt: s.dueAt,
    status: s.status === "DRAFTED" ? "DRAFTED" : "QUEUED",
    intent: s.step.intent,
    fixedLine: s.step.fixedLine || null,
    voicePhrase: s.step.voicePhrase || null,
    resource: s.step.resource,
    window: win,
    draft: d?.status === "PENDING" ? { id: d.id, bubbles: d.bubbles, flags: d.flags, reasoning: d.reasoning, humanAgent: d.humanAgent } : null,
    callAt: call?.start ?? null,
    callTz: call?.timezone ?? null,
  };
}

async function bookingTimes(workspaceId: string, ids: string[]): Promise<Map<string, { start: string; timezone: string }>> {
  const out = new Map<string, { start: string; timezone: string }>();
  if (!ids.length) return out;
  if (osMockEnabled()) {
    for (const id of ids) {
      const b = mockBookingRows().get(id);
      if (b) out.set(id, { start: b.start, timezone: b.timezone });
    }
    return out;
  }
  const rows = await prisma.booking.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true, start: true, timezone: true } });
  for (const r of rows) out.set(r.id, { start: r.start.toISOString(), timezone: r.timezone });
  return out;
}

function counter(workspaceId: string) {
  const cache = new Map<string, number>();
  const steps = sequenceStore();
  return async (s: StepRow) => {
    const k = `${s.setterId ?? ""}:${s.sequence}`;
    if (!cache.has(k)) {
      const { set } = await steps.loadSet(workspaceId, s.setterId);
      cache.set(k, isSequenceKey(s.sequence) ? set[s.sequence].steps.length : s.stepIndex + 1);
    }
    return Math.max(cache.get(k)!, s.stepIndex + 1);
  };
}

async function queueViews(workspaceId: string, live: StepRow[]): Promise<QueuedFollowup[]> {
  const who = await people(workspaceId, [...new Set(live.map((s) => s.contactId))]);
  const pending = await setterStore().listPending(workspaceId);
  const drafts = new Map(pending.map((d) => [d.id, d]));
  const bookings = await bookingTimes(workspaceId, live.flatMap((s) => (s.bookingId ? [s.bookingId] : [])));
  const count = counter(workspaceId);
  const out: QueuedFollowup[] = [];
  for (const s of live) {
    const p = who.get(s.contactId);
    if (p) out.push(await stepView(s, p, drafts, bookings, count));
  }
  // Drafted first (waiting for you), then by time.
  return out.sort((a, b) => (a.status === b.status ? a.dueAt.localeCompare(b.dueAt) : a.status === "DRAFTED" ? -1 : 1));
}

/** Calls that are over with no Showed / No-show yet (last two weeks). */
async function needsAttendance(workspaceId: string, now: Date, contactId?: string): Promise<AttendanceItem[]> {
  const since = now.getTime() - 14 * 86_400_000;
  const over = now.getTime() - CALL_OVER_MS;
  let rows: { id: string; contactId: string; start: string; timezone: string }[];
  if (osMockEnabled()) {
    rows = [...mockBookingRows().values()]
      .filter((b) => !b.attendance && b.status !== "CANCELLED" && b.status !== "LINK_SENT")
      .filter((b) => new Date(b.start).getTime() < over && new Date(b.start).getTime() > since && (!contactId || b.contactId === contactId))
      .map((b) => ({ id: b.id, contactId: b.contactId, start: b.start, timezone: b.timezone }));
  } else {
    rows = (
      await prisma.booking.findMany({
        where: { workspaceId, attendance: null, status: { in: ["BOOKED", "CONFIRMED"] }, start: { lt: new Date(over), gt: new Date(since) }, ...(contactId ? { contactId } : {}) },
        orderBy: { start: "desc" },
        take: 50,
      })
    ).map((b) => ({ id: b.id, contactId: b.contactId, start: b.start.toISOString(), timezone: b.timezone }));
  }
  const who = await people(workspaceId, [...new Set(rows.map((r) => r.contactId))]);
  // Only each person's latest call.
  const seen = new Set<string>();
  return rows.flatMap((r) => {
    const p = who.get(r.contactId);
    if (!p || seen.has(r.contactId)) return [];
    seen.add(r.contactId);
    return [{ contactId: p.contactId, username: p.username, fullName: p.fullName, avatarUrl: p.avatarUrl, conversationId: p.conversationId, bookingId: r.id, start: r.start, timezone: r.timezone }];
  });
}

async function taskViews(workspaceId: string, rows: TaskRow[]): Promise<TaskItem[]> {
  const who = await people(workspaceId, [...new Set(rows.map((t) => t.contactId))]);
  return rows.flatMap((t) => {
    const p = who.get(t.contactId);
    if (!p) return [];
    return [{ contactId: p.contactId, username: p.username, fullName: p.fullName, avatarUrl: p.avatarUrl, conversationId: p.conversationId, id: t.id, title: t.title, context: t.context, status: t.status, createdAt: t.createdAt }];
  });
}

export async function loadFollowupScreen(workspaceId: string, now = new Date()): Promise<FollowupScreen> {
  await mockFollowupTick(now);
  const steps = sequenceStore();
  const [live, attendance, tasks] = await Promise.all([steps.listLive(workspaceId), needsAttendance(workspaceId, now), steps.listTasks(workspaceId, { open: true })]);
  return { queue: await queueViews(workspaceId, live), attendance, tasks: await taskViews(workspaceId, tasks) };
}

/** Home: open voice-note tasks and calls waiting for Showed / No-show. */
export async function loadHomeFollowups(workspaceId: string, now = new Date()) {
  await mockFollowupTick(now);
  const [tasks, attendance] = await Promise.all([sequenceStore().listTasks(workspaceId, { open: true }), needsAttendance(workspaceId, now)]);
  return { tasks: await taskViews(workspaceId, tasks), attendance };
}

/** The strip on a thread. */
export async function loadThreadFollowups(workspaceId: string, contactId: string, now = new Date()): Promise<ThreadFollowups> {
  await mockFollowupTick(now);
  const steps = sequenceStore();
  const setter = setterStore();
  const contact = await setter.getContact(contactId, workspaceId);
  const empty: ThreadFollowups = { live: null, why: null, off: false, upcoming: [], attendance: null, tasks: [] };
  if (!contact) return empty;
  const [liveRows, off, booking, tasks, attendance] = await Promise.all([
    steps.listLive(workspaceId, { contactIds: [contactId] }),
    steps.followupsOff(contactId),
    steps.latestBooking(workspaceId, contactId),
    steps.listTasks(workspaceId, { contactId, open: true }),
    needsAttendance(workspaceId, now, contactId),
  ]);
  const [live] = await queueViews(workspaceId, liveRows);
  let why: string | null = null;
  if (!live) why = (await planFor(contact, { now })).result.why || null;
  let upcoming: ThreadFollowups["upcoming"] = [];
  if (booking && booking.status !== "CANCELLED" && new Date(booking.start).getTime() > now.getTime()) {
    const { set } = await steps.loadSet(workspaceId, contact.setterId ?? null, contact.instagramAccountId);
    if (set.pre_call.enabled) {
      const done = new Set((await steps.history(contactId)).filter((h) => h.status === "SENT").map((h) => h.key));
      upcoming = preCallTimeline(set.pre_call.steps, booking)
        .filter((e) => !done.has(e.key) && e.dueAt.getTime() > now.getTime() - 60_000)
        .map((e) => ({ label: e.step.label, at: e.dueAt.toISOString(), dropped: e.dropped }));
    }
  }
  return { live: live ?? null, why, off, upcoming, attendance: attendance[0] ?? null, tasks: await taskViews(workspaceId, tasks) };
}

