// Follow-ups tab data and the panel's "next follow-up" line. Owner: S5.
// One person: what's queued from their setter's sequences, the broadcasts
// they're in, and the two switches (follow-ups on, on the Friday list).

import type { PanelFollowup } from "@/lib/os/contact-panel/types";
import { goalOf, hhmm, dayLabel, localDay, sequenceHref, sequenceLabel, broadcastHref } from "@/lib/os/followups-timeline";

export interface PanelStep {
  id: string;
  /** "J · Gone quiet · step 1/3" */
  source: string;
  href: string;
  /** "Tomorrow, 10:00" */
  when: string;
  at: string;
  /** The message, or the goal when J writes at send time. */
  preview: string;
  writesAtSendTime: boolean;
  ready: boolean;
  stepId: string | null;
}

export interface PanelBroadcast {
  id: string;
  name: string;
  href: string;
  status: string;
  when: string | null;
  preview: string;
}

export interface ContactFollowupsData {
  contactId: string;
  /** Sequences off for this person. */
  off: boolean;
  /** Why nothing is queued, when nothing is. */
  why: string | null;
  steps: PanelStep[];
  broadcasts: PanelBroadcast[];
  /** On the Follow-up Friday list (the tag). */
  onFriday: boolean;
}

const EMPTY = (contactId: string): ContactFollowupsData => ({ contactId, off: false, why: null, steps: [], broadcasts: [], onFriday: false });

function when(iso: string, now: Date, tz: string): string {
  const at = new Date(iso);
  return `${dayLabel(localDay(at, tz), now, tz)}, ${hhmm(at, tz)}`;
}

const BROADCAST_STATUS: Record<string, string> = {
  drafted: "Draft to review",
  approved: "Approved",
  scheduled: "Scheduled",
  sent: "Sent",
  skipped: "Left out",
  failed: "Failed",
  outside_window: "Outside window",
};

export async function loadContactFollowups(workspaceId: string, contactId: string, now = new Date()): Promise<ContactFollowupsData> {
  const [{ loadThreadFollowups }, { broadcastStore }, { getWorkspaceSettings, DEFAULT_SETTINGS }, { prisma }, { FOLLOW_UP_FRIDAY }] = await Promise.all([
    import("@/lib/os/sequences/view"),
    import("@/lib/os/broadcasts/store"),
    import("@/lib/os/workspace-settings"),
    import("@/lib/db/client"),
    import("@/lib/os/broadcasts/types"),
  ]);
  const tz = await getWorkspaceSettings(workspaceId)
    .then((s) => s.timezone)
    .catch(() => DEFAULT_SETTINGS.timezone);
  const store = broadcastStore();
  const [thread, rows, contact] = await Promise.all([
    loadThreadFollowups(workspaceId, contactId, now).catch(() => null),
    store.rows(workspaceId, { contactId, take: 6 }).catch(() => []),
    store.contact(workspaceId, contactId).catch(() => null),
  ]);
  if (!thread && !rows.length && !contact) return EMPTY(contactId);

  const names = new Map<string, string>();
  try {
    for (const s of await prisma.setter.findMany({ where: { workspaceId }, select: { id: true, name: true } })) names.set(s.id, s.name);
  } catch {
    // sample data without setters: "J"
  }

  const steps: PanelStep[] = [];
  const live = thread?.live ?? null;
  if (live) {
    const name = (live.setterId && names.get(live.setterId)) || "J";
    const ready = live.status === "DRAFTED" && Boolean(live.draft);
    const msg = ready ? live.draft!.bubbles.join(" ") : live.fixedLine;
    steps.push({
      id: live.stepId,
      source: `${name} · ${sequenceLabel(live.sequence)} · step ${live.stepNo}/${live.stepCount}`,
      href: sequenceHref(live.setterId),
      when: when(live.dueAt, now, tz),
      at: live.dueAt,
      preview: msg ?? goalOf(live.intent, live.label),
      writesAtSendTime: !msg,
      ready,
      stepId: live.stepId,
    });
  }
  for (const u of thread?.upcoming ?? []) {
    if (live && Math.abs(new Date(u.at).getTime() - new Date(live.dueAt).getTime()) < 60_000) continue;
    steps.push({ id: `up:${u.at}`, source: `${sequenceLabel("pre_call")}`, href: sequenceHref(live?.setterId ?? null), when: when(u.at, now, tz), at: u.at, preview: u.dropped ? `${u.label} (skipped: ${u.dropped})` : u.label, writesAtSendTime: true, ready: false, stepId: null });
  }

  const broadcasts: PanelBroadcast[] = rows.map((m) => ({
    id: m.id,
    name: m.broadcastName,
    href: broadcastHref(m.broadcastKey),
    status: BROADCAST_STATUS[m.status] ?? m.status,
    when: m.sentAt ? when(m.sentAt, now, tz) : m.scheduledAt ? when(m.scheduledAt, now, tz) : null,
    preview: m.bubbles.join(" "),
  }));

  return {
    contactId,
    off: thread?.off ?? false,
    why: steps.length ? null : (thread?.why ?? null),
    steps,
    broadcasts,
    onFriday: Boolean(contact?.tags.includes(FOLLOW_UP_FRIDAY.tag)),
  };
}

const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });

/** "Follow-up Wed 10:00" from a due time. */
export function followupLabel(at: Date, timeZone?: string): string {
  const f = timeZone ? new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone }) : DAY;
  return `Follow-up ${f.format(at).replace(",", "")}`;
}

/** The panel's one line: when the next step goes, linking to the timeline. */
export function nextFollowupLine(step: { dueAt: Date; label?: string | null; sequence?: string | null } | null, timeZone?: string): PanelFollowup | null {
  if (!step) return null;
  const what = step.sequence ? sequenceLabel(step.sequence) : null;
  return {
    label: followupLabel(step.dueAt, timeZone),
    at: step.dueAt.toISOString(),
    href: "/os/follow-ups?tab=scheduled",
    tip: step.label ? `${what ? `${what}: ` : ""}${step.label}. Sends if no reply.` : null,
  };
}
