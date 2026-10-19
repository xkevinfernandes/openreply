// The Follow-ups timeline (board FollowupsA), pure: no IO, the clock passed in.
// Tabs Yours to do · Scheduled · Sent · Paused; a source filter (each setter's
// sequences, broadcasts); Scheduled grouped by day. Each row says where it
// comes from ("J · Gone quiet · step 1/3", "Broadcast · Follow-up Friday")
// and links to where that is defined. When J writes at send time the preview
// is the step's goal in a few words.

import type { BroadcastNeed } from "@/lib/os/broadcasts/engine";
import type { BroadcastMessageRow } from "@/lib/os/broadcasts/types";
import type { AttendanceItem, QueuedFollowup, TaskItem } from "@/lib/os/sequences/view";

export type TimelineTab = "todo" | "scheduled" | "sent" | "paused";
export const TIMELINE_TABS: { key: TimelineTab; label: string }[] = [
  { key: "todo", label: "Yours to do" },
  { key: "scheduled", label: "Scheduled" },
  { key: "sent", label: "Sent" },
  { key: "paused", label: "Paused" },
];

export function timelineTab(v: string | null | undefined): TimelineTab {
  return (TIMELINE_TABS.find((t) => t.key === v)?.key ?? "scheduled") as TimelineTab;
}

export interface Who {
  contactId: string;
  handle: string;
  initial: string;
  avatarUrl: string | null;
  conversationId: string | null;
}

export interface TimelineRow extends Who {
  id: string;
  kind: "step" | "broadcast";
  /** "setter:<id>" or "broadcasts". */
  sourceKey: string;
  source: string;
  sourceHref: string;
  /** The message, or null when J writes it at send time. */
  preview: string | null;
  /** The step goal in a few words (J writes at send time). */
  goal: string | null;
  at: string;
  /** "16:00" in the workspace timezone. */
  time: string;
  /** A J draft is waiting (Send now = approve). */
  ready: boolean;
  stepId: string | null;
  messageId: string | null;
  draftId: string | null;
}

export interface BroadcastBanner {
  key: string;
  name: string;
  count: number;
  kind: BroadcastNeed["kind"];
  time: string;
  href: string;
}

export interface DayGroup {
  date: string;
  /** "Today", "Tomorrow", "Thu 22 Oct" */
  day: string;
  rows: TimelineRow[];
  banners: BroadcastBanner[];
}

export interface TodoItem {
  id: string;
  kind: "task" | "attendance" | "broadcast";
  /** The line: lead + strong part ("Send Loom to" + "priya.studio"). */
  lead: string;
  strong: string;
  tail: string;
  source: string;
  sourceHref: string;
  due: string;
  warn: boolean;
  action: { label: string; href: string };
  contactId: string | null;
  taskId: string | null;
}

export interface SentRow extends Who {
  id: string;
  sourceKey: string;
  source: string;
  sourceHref: string;
  preview: string | null;
  at: string;
  /** "Mon 19 Oct, 16:02" */
  when: string;
}

export interface PausedRow extends Who {
  id: string;
  sourceKey: string;
  source: string;
  sourceHref: string;
  /** Why it's paused (follow-ups off, paused contact). */
  reason: string;
}

export interface Timeline {
  todo: TodoItem[];
  scheduled: DayGroup[];
  sent: SentRow[];
  paused: PausedRow[];
  counts: Record<TimelineTab, number>;
  sources: { key: string; label: string }[];
}

export interface SentStep extends Who {
  stepId: string;
  sequence: string;
  setterId: string | null;
  label: string;
  stepNo: number;
  doneAt: string;
}

export interface PausedContact extends Who {
  setterId: string | null;
  reason: string;
}

export interface TimelineInput {
  queue: QueuedFollowup[];
  tasks: TaskItem[];
  attendance: AttendanceItem[];
  broadcasts: BroadcastMessageRow[];
  needs: BroadcastNeed[];
  sentSteps: SentStep[];
  pausedContacts: PausedContact[];
  /** Handles for broadcast rows. */
  people: Map<string, Who>;
  setterNames: Map<string, string>;
  now: Date;
  timeZone: string;
}

// ---------------------------------------------------------------- labels

const GROUP_LABEL: Record<string, string> = {
  no_reply_lead: "Gone quiet",
  no_reply_qualifying: "Gone quiet",
  no_reply_value: "Gone quiet",
  no_reply_invite: "Gone quiet",
  pre_call: "Before the call",
  no_show: "After the call: No-show",
  showed: "After the call: Showed",
};

export function sequenceLabel(sequence: string): string {
  return GROUP_LABEL[sequence] ?? sequence.replace(/_/g, " ");
}

/** "J · Gone quiet · step 1/3" */
export function stepSource(setterName: string, sequence: string, stepNo: number, stepCount?: number): string {
  return `${setterName} · ${sequenceLabel(sequence)} · step ${stepNo}${stepCount ? `/${stepCount}` : ""}`;
}

/** Where a setter's sequences are defined (Knowledge bases › the setter › Follow-ups). */
export function sequenceHref(setterId: string | null): string {
  return setterId ? `/os/knowledge/${setterId}?section=followups` : "/os/knowledge";
}

/** The chat for a contact (the Inbox selects by conversation). */
export function chatHref(conversationId: string | null): string {
  return conversationId ? `/os/inbox?c=${encodeURIComponent(conversationId)}` : "/os/inbox";
}

export function broadcastHref(key: string): string {
  return `/os/automations/broadcasts/${key}`;
}

/** The step's goal in a few words: the first clause of its intent, else the label. */
export function goalOf(intent: string | null | undefined, label: string, maxWords = 6): string {
  const first = (intent ?? "").split(/[.;:!?\n]| - | — /)[0].trim();
  const words = (first || label).split(/\s+/).filter(Boolean);
  const short = words.slice(0, maxWords).join(" ");
  const out = words.length > maxWords ? `${short.replace(/[,]$/, "")}…` : short;
  return out ? out[0].toUpperCase() + out.slice(1) : label;
}

function fmt(at: Date, tz: string, o: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, ...o }).format(at);
}

export function localDay(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function hhmm(at: Date, tz: string): string {
  return fmt(at, tz, { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** "Today", "Tomorrow", else "Thu 22 Oct". */
export function dayLabel(date: string, now: Date, tz: string): string {
  const today = localDay(now, tz);
  const tomorrow = localDay(new Date(now.getTime() + 86_400_000), tz);
  if (date === today) return "Today";
  if (date === tomorrow) return "Tomorrow";
  const [y, m, d] = date.split("-").map(Number);
  return fmt(new Date(Date.UTC(y, m - 1, d, 12)), "UTC", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
}

function shortDue(at: Date, now: Date, tz: string): string {
  const d = dayLabel(localDay(at, tz), now, tz);
  return d.length > 8 ? d.split(" ")[0] : d;
}

// ---------------------------------------------------------------- build

export function buildTimeline(i: TimelineInput): Timeline {
  const tz = i.timeZone;
  const setter = (id: string | null) => (id ? (i.setterNames.get(id) ?? "J") : "J");
  const sourcesSeen = new Map<string, string>();

  const rows: TimelineRow[] = [];
  for (const q of i.queue) {
    const name = setter(q.setterId);
    const sourceKey = `setter:${q.setterId ?? "default"}`;
    sourcesSeen.set(sourceKey, `${name} · sequences`);
    const at = new Date(q.dueAt);
    const ready = q.status === "DRAFTED" && Boolean(q.draft);
    const preview = ready ? q.draft!.bubbles.join(" ") : q.fixedLine;
    rows.push({
      id: `step:${q.stepId}`,
      kind: "step",
      contactId: q.contactId,
      handle: q.username ?? q.fullName ?? "unknown",
      initial: (q.username ?? q.fullName ?? "?")[0].toUpperCase(),
      avatarUrl: q.avatarUrl,
      conversationId: q.conversationId,
      sourceKey,
      source: stepSource(name, q.sequence, q.stepNo, q.stepCount),
      sourceHref: sequenceHref(q.setterId),
      preview,
      goal: preview ? null : goalOf(q.intent, q.label),
      at: q.dueAt,
      time: hhmm(at, tz),
      ready,
      stepId: q.stepId,
      messageId: null,
      draftId: q.draft?.id ?? null,
    });
  }

  for (const m of i.broadcasts) {
    if (m.status !== "scheduled" || !m.scheduledAt) continue;
    const who = i.people.get(m.contactId);
    if (!who) continue;
    sourcesSeen.set("broadcasts", "Broadcasts");
    const at = new Date(m.scheduledAt);
    rows.push({
      ...who,
      id: `bm:${m.id}`,
      kind: "broadcast",
      sourceKey: "broadcasts",
      source: `Broadcast · ${m.broadcastName}`,
      sourceHref: broadcastHref(m.broadcastKey),
      preview: m.bubbles.join(" "),
      goal: null,
      at: m.scheduledAt,
      time: hhmm(at, tz),
      ready: false,
      stepId: null,
      messageId: m.id,
      draftId: null,
    });
  }
  rows.sort((a, b) => a.at.localeCompare(b.at));

  // Group by day; overdue steps sit under Today.
  const today = localDay(i.now, tz);
  const groups = new Map<string, DayGroup>();
  const group = (date: string) => {
    const key = date < today ? today : date;
    if (!groups.has(key)) groups.set(key, { date: key, day: dayLabel(key, i.now, tz), rows: [], banners: [] });
    return groups.get(key)!;
  };
  for (const r of rows) group(localDay(new Date(r.at), tz)).rows.push(r);
  for (const n of i.needs) {
    sourcesSeen.set("broadcasts", "Broadcasts");
    group(n.runDate).banners.push({ key: n.key, name: n.name, count: n.count, kind: n.kind, time: n.windowStart, href: broadcastHref(n.key) });
  }
  const scheduled = [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));

  // Yours to do: what only Kevin can do.
  const todo: TodoItem[] = [];
  for (const a of i.attendance) {
    todo.push({
      id: `att:${a.bookingId}`,
      kind: "attendance",
      lead: "Did",
      strong: a.username ?? a.fullName ?? "they",
      tail: "show?",
      source: "Call",
      sourceHref: chatHref(a.conversationId),
      due: shortDue(new Date(a.start), i.now, tz),
      warn: true,
      action: { label: "Open chat", href: chatHref(a.conversationId) },
      contactId: a.contactId,
      taskId: null,
    });
  }
  for (const t of i.tasks) {
    const handle = t.username ?? t.fullName ?? "them";
    const idx = t.title.indexOf(handle);
    todo.push({
      id: `task:${t.id}`,
      kind: "task",
      lead: idx >= 0 ? t.title.slice(0, idx).replace(/@$/, "").trimEnd() : t.title,
      strong: idx >= 0 ? handle : "",
      tail: idx >= 0 ? t.title.slice(idx + handle.length).trimStart() : "",
      source: "After the call: Showed",
      sourceHref: chatHref(t.conversationId),
      due: shortDue(new Date(t.createdAt), i.now, tz),
      warn: localDay(new Date(t.createdAt), tz) <= today,
      action: { label: "Open chat", href: chatHref(t.conversationId) },
      contactId: t.contactId,
      taskId: t.id,
    });
  }
  for (const n of i.needs) {
    todo.push({
      id: `bc:${n.key}:${n.kind}`,
      kind: "broadcast",
      lead: n.kind === "link" ? "Paste this week's link for" : `Review ${n.count} ${n.count === 1 ? "draft" : "drafts"} for`,
      strong: n.name,
      tail: "",
      source: `Broadcast · ${n.name}`,
      sourceHref: broadcastHref(n.key),
      due: n.today ? "Today" : n.day,
      warn: n.today,
      action: { label: n.kind === "link" ? "Add link" : "Review", href: broadcastHref(n.key) },
      contactId: null,
      taskId: null,
    });
  }

  const sent: SentRow[] = [
    ...i.sentSteps.map((s) => {
      const name = setter(s.setterId);
      const key = `setter:${s.setterId ?? "default"}`;
      sourcesSeen.set(key, `${name} · sequences`);
      return {
        contactId: s.contactId,
        handle: s.handle,
        initial: s.initial,
        avatarUrl: s.avatarUrl,
        conversationId: s.conversationId,
        id: `step:${s.stepId}`,
        sourceKey: key,
        source: stepSource(name, s.sequence, s.stepNo),
        sourceHref: sequenceHref(s.setterId),
        preview: s.label,
        at: s.doneAt,
        when: `${dayLabel(localDay(new Date(s.doneAt), tz), i.now, tz)}, ${hhmm(new Date(s.doneAt), tz)}`,
      };
    }),
    ...i.broadcasts
      .filter((m) => m.status === "sent" && m.sentAt && i.people.has(m.contactId))
      .map((m) => {
        sourcesSeen.set("broadcasts", "Broadcasts");
        return {
          ...i.people.get(m.contactId)!,
          id: `bm:${m.id}`,
          sourceKey: "broadcasts",
          source: `Broadcast · ${m.broadcastName}`,
          sourceHref: broadcastHref(m.broadcastKey),
          preview: m.bubbles.join(" "),
          at: m.sentAt!,
          when: `${dayLabel(localDay(new Date(m.sentAt!), tz), i.now, tz)}, ${hhmm(new Date(m.sentAt!), tz)}`,
        };
      }),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const paused: PausedRow[] = i.pausedContacts.map((p) => {
    const name = setter(p.setterId);
    const key = `setter:${p.setterId ?? "default"}`;
    sourcesSeen.set(key, `${name} · sequences`);
    return { ...p, id: `paused:${p.contactId}`, sourceKey: key, source: `${name} · sequences`, sourceHref: sequenceHref(p.setterId) };
  });

  // Every setter appears in the filter even before it has a row.
  for (const [id, name] of i.setterNames) if (!sourcesSeen.has(`setter:${id}`)) sourcesSeen.set(`setter:${id}`, `${name} · sequences`);
  sourcesSeen.set("broadcasts", "Broadcasts");
  const sources = [
    { key: "all", label: "All sources" },
    ...[...sourcesSeen.entries()].filter(([k]) => k !== "broadcasts").map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label)),
    { key: "broadcasts", label: "Broadcasts" },
  ];

  return {
    todo,
    scheduled,
    sent,
    paused,
    counts: { todo: todo.length, scheduled: rows.length, sent: sent.length, paused: paused.length },
    sources,
  };
}

/** Narrow a timeline to one source ("all" keeps everything). Yours to do is never filtered. */
export function filterTimeline(t: Timeline, source: string): Timeline {
  if (!source || source === "all") return t;
  const keep = <T extends { sourceKey: string }>(xs: T[]) => xs.filter((x) => x.sourceKey === source);
  const scheduled = t.scheduled
    .map((g) => ({ ...g, rows: keep(g.rows), banners: source === "broadcasts" ? g.banners : [] }))
    .filter((g) => g.rows.length || g.banners.length);
  const sent = keep(t.sent);
  const paused = keep(t.paused);
  return {
    ...t,
    scheduled,
    sent,
    paused,
    counts: { todo: t.counts.todo, scheduled: scheduled.reduce((n, g) => n + g.rows.length, 0), sent: sent.length, paused: paused.length },
  };
}
