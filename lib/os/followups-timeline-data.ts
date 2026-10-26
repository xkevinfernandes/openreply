// IO for the Follow-ups timeline: loads what lib/os/followups-timeline.ts
// arranges. Postgres, or the sample inbox with OS_MOCK=1.

import { prisma } from "@/lib/db/client";
import { buildTimeline, type PausedContact, type SentStep, type Timeline, type Who } from "@/lib/os/followups-timeline";
import { mockThreads, osMockEnabled } from "@/lib/os/mock";
import { sequenceStore } from "@/lib/os/sequences/store";
import { loadFollowupScreen } from "@/lib/os/sequences/view";
import { DEFAULT_SETTINGS, getWorkspaceSettings } from "@/lib/os/workspace-settings";

function who(id: string, username: string | null, fullName: string | null, avatarUrl: string | null, conversationId: string | null): Who {
  const handle = username ?? fullName ?? "unknown";
  return { contactId: id, handle, initial: handle[0]?.toUpperCase() ?? "?", avatarUrl, conversationId };
}

async function peopleFor(workspaceId: string, ids: string[]): Promise<Map<string, Who>> {
  const out = new Map<string, Who>();
  if (!ids.length) return out;
  if (osMockEnabled()) {
    for (const t of mockThreads()) if (t.contact && ids.includes(t.contact.id)) out.set(t.contact.id, who(t.contact.id, t.username, t.fullName ?? null, t.avatarUrl ?? null, t.conversationId));
    return out;
  }
  const rows = await prisma.contact.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true, username: true, fullName: true, avatarUrl: true, zernioConversationId: true } });
  for (const c of rows) out.set(c.id, who(c.id, c.username, c.fullName, c.avatarUrl, c.zernioConversationId));
  return out;
}

async function sentSteps(workspaceId: string): Promise<SentStep[]> {
  if (osMockEnabled()) {
    const steps = sequenceStore();
    const out: SentStep[] = [];
    for (const t of mockThreads()) {
      if (!t.contact) continue;
      for (const h of await steps.history(t.contact.id)) {
        if (h.status !== "SENT" || !h.doneAt) continue;
        out.push({ ...who(t.contact.id, t.username, t.fullName ?? null, t.avatarUrl ?? null, t.conversationId), stepId: h.id, sequence: h.sequence, setterId: h.setterId, label: h.step.label, stepNo: h.stepIndex + 1, doneAt: h.doneAt });
      }
    }
    return out;
  }
  const rows = await prisma.followupStep.findMany({
    where: { workspaceId, status: "SENT" },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, sequence: true, setterId: true, step: true, stepIndex: true, updatedAt: true, contact: { select: { id: true, username: true, fullName: true, avatarUrl: true, zernioConversationId: true } } },
  });
  return rows.map((r) => ({
    ...who(r.contact.id, r.contact.username, r.contact.fullName, r.contact.avatarUrl, r.contact.zernioConversationId),
    stepId: r.id,
    sequence: r.sequence,
    setterId: r.setterId,
    label: (r.step as { label?: string } | null)?.label ?? "Follow-up",
    stepNo: r.stepIndex + 1,
    doneAt: r.updatedAt.toISOString(),
  }));
}

async function pausedContacts(workspaceId: string): Promise<PausedContact[]> {
  if (osMockEnabled()) {
    const steps = sequenceStore();
    const out: PausedContact[] = [];
    for (const t of mockThreads()) {
      if (!t.contact || t.contact.kind !== "SALES") continue;
      const off = await steps.followupsOff(t.contact.id);
      if (off || t.contact.paused) out.push({ ...who(t.contact.id, t.username, t.fullName ?? null, t.avatarUrl ?? null, t.conversationId), setterId: null, reason: off ? "Follow-ups off" : "Contact paused" });
    }
    return out;
  }
  const rows = await prisma.contact.findMany({
    where: { workspaceId, kind: "SALES", OR: [{ followupsOff: true }, { paused: true }] },
    select: { id: true, username: true, fullName: true, avatarUrl: true, zernioConversationId: true, setterId: true, followupsOff: true },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return rows.map((c) => ({ ...who(c.id, c.username, c.fullName, c.avatarUrl, c.zernioConversationId), setterId: c.setterId, reason: c.followupsOff ? "Follow-ups off" : "Contact paused" }));
}

async function setterNames(workspaceId: string): Promise<Map<string, string>> {
  try {
    const rows = await prisma.setter.findMany({ where: { workspaceId }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
    return new Map(rows.map((r) => [r.id, r.name]));
  } catch {
    return new Map();
  }
}

export async function loadTimeline(workspaceId: string, now = new Date()): Promise<Timeline> {
  // Broadcasts are one-off records under Automations now: not on this timeline.
  const [screen, sent, paused, names, tz] = await Promise.all([
    loadFollowupScreen(workspaceId, now),
    sentSteps(workspaceId),
    pausedContacts(workspaceId),
    setterNames(workspaceId),
    getWorkspaceSettings(workspaceId)
      .then((s) => s.timezone)
      .catch(() => DEFAULT_SETTINGS.timezone),
  ]);
  const people = await peopleFor(workspaceId, []);
  return buildTimeline({
    queue: screen.queue,
    tasks: screen.tasks,
    attendance: screen.attendance,
    broadcasts: [],
    needs: [],
    sentSteps: sent,
    pausedContacts: paused,
    people,
    setterNames: names,
    now,
    timeZone: tz,
  });
}
