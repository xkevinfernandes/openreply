// Where broadcasts live: Broadcast, BroadcastRun, BroadcastMessage, and the
// tagged contacts the audience reads. Postgres, or memory with OS_MOCK=1
// (lib/os/mock-followups.ts).

import { prisma } from "@/lib/db/client";
import { osMockEnabled } from "@/lib/os/mock";
import { mockBroadcastStore } from "@/lib/os/mock-followups";
import type {
  BroadcastContact,
  BroadcastMessageRow,
  BroadcastMessageStatus,
  BroadcastMessageView,
  BroadcastRunStatus,
  BroadcastRunView,
  BroadcastView,
} from "@/lib/os/broadcasts/types";

export type BroadcastPatch = Partial<Omit<BroadcastView, "id" | "key">>;

export interface MessagePatch {
  bubbles?: string[];
  followupBubbles?: string[];
  status?: BroadcastMessageStatus;
  edited?: boolean;
  scheduledAt?: string | null;
  sentAt?: string | null;
  error?: string | null;
  reasoning?: string | null;
}

export interface BroadcastStore {
  list(workspaceId: string): Promise<BroadcastView[]>;
  get(workspaceId: string, key: string): Promise<BroadcastView | null>;
  getById(id: string): Promise<(BroadcastView & { workspaceId: string }) | null>;
  update(workspaceId: string, id: string, patch: BroadcastPatch): Promise<BroadcastView>;
  getRun(broadcastId: string, runDate: string): Promise<BroadcastRunView | null>;
  getRunById(runId: string): Promise<BroadcastRunView | null>;
  latestRuns(broadcastId: string, take: number): Promise<BroadcastRunView[]>;
  createRun(broadcastId: string, runDate: string, link: string): Promise<BroadcastRunView>;
  updateRun(runId: string, patch: { link?: string; status?: BroadcastRunStatus }): Promise<void>;
  messages(runId: string): Promise<BroadcastMessageView[]>;
  getMessage(id: string): Promise<(BroadcastMessageView & { runId: string; workspaceId: string }) | null>;
  /** Create or replace the run's message for a contact. */
  upsertMessage(runId: string, workspaceId: string, contactId: string, data: MessagePatch): Promise<BroadcastMessageView>;
  updateMessage(id: string, patch: MessagePatch): Promise<void>;
  /** Messages with their run and broadcast, newest run first. */
  rows(workspaceId: string, opts: { statuses?: BroadcastMessageStatus[]; contactId?: string; take?: number }): Promise<BroadcastMessageRow[]>;
  /** Contacts carrying a tag, with what J knows about them. */
  taggedContacts(workspaceId: string, tag: string): Promise<BroadcastContact[]>;
  /** One contact, fresh (send-time re-checks). */
  contact(workspaceId: string, contactId: string): Promise<BroadcastContact | null>;
  setTag(workspaceId: string, contactId: string, tag: string, on: boolean): Promise<void>;
}

type BroadcastRow = {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  audienceTag: string;
  link: string | null;
  template: string;
  followupTemplate: string | null;
  followupDelayMin: number;
  windowDay: number;
  windowStart: string;
  windowEnd: string;
  timezone: string;
  setterId: string | null;
  enabled: boolean;
};

export function broadcastView(b: BroadcastRow): BroadcastView {
  return {
    id: b.id,
    key: b.key,
    name: b.name,
    audienceTag: b.audienceTag,
    link: b.link,
    template: b.template,
    followupTemplate: b.followupTemplate,
    followupDelayMin: b.followupDelayMin,
    windowDay: b.windowDay,
    windowStart: b.windowStart,
    windowEnd: b.windowEnd,
    timezone: b.timezone,
    setterId: b.setterId,
    enabled: b.enabled,
  };
}

function runView(r: { id: string; broadcastId: string; runDate: string; link: string; status: string; createdAt: Date }): BroadcastRunView {
  return { id: r.id, broadcastId: r.broadcastId, runDate: r.runDate, link: r.link, status: r.status as BroadcastRunStatus, createdAt: r.createdAt.toISOString() };
}

type MessageRow = {
  id: string;
  contactId: string;
  bubbles: string[];
  followupBubbles: string[];
  status: string;
  edited: boolean;
  scheduledAt: Date | null;
  sentAt: Date | null;
  error: string | null;
  reasoning: string | null;
};

function messageView(m: MessageRow): BroadcastMessageView {
  return {
    id: m.id,
    contactId: m.contactId,
    bubbles: m.bubbles,
    followupBubbles: m.followupBubbles,
    status: m.status as BroadcastMessageStatus,
    edited: m.edited,
    scheduledAt: m.scheduledAt?.toISOString() ?? null,
    sentAt: m.sentAt?.toISOString() ?? null,
    error: m.error,
    reasoning: m.reasoning,
  };
}

function messageData(p: MessagePatch) {
  return {
    ...(p.bubbles ? { bubbles: p.bubbles } : {}),
    ...(p.followupBubbles ? { followupBubbles: p.followupBubbles } : {}),
    ...(p.status ? { status: p.status } : {}),
    ...(p.edited !== undefined ? { edited: p.edited } : {}),
    ...(p.scheduledAt !== undefined ? { scheduledAt: p.scheduledAt ? new Date(p.scheduledAt) : null } : {}),
    ...(p.sentAt !== undefined ? { sentAt: p.sentAt ? new Date(p.sentAt) : null } : {}),
    ...(p.error !== undefined ? { error: p.error } : {}),
    ...(p.reasoning !== undefined ? { reasoning: p.reasoning } : {}),
  };
}

async function loadContacts(where: { workspaceId: string; id?: string; tags?: { has: string } }): Promise<BroadcastContact[]> {
    const rows = await prisma.contact.findMany({
      where,
      select: {
        id: true,
        username: true,
        fullName: true,
        kind: true,
        paused: true,
        tags: true,
        igUserId: true,
        zernioConversationId: true,
        setterStage: true,
        stage: true,
        notes: true,
        setterState: { select: { record: true } },
      },
      take: 500,
    });
    const values = rows.length
      ? await prisma.contactFieldValue.findMany({ where: { contactId: { in: rows.map((r) => r.id) } }, select: { contactId: true, value: true, field: { select: { label: true, key: true } } } })
      : [];
    return rows.map((c) => {
      const rec = (c.setterState?.record ?? null) as { their_last_at?: string | null; our_last_at?: string | null } | null;
      return {
        contactId: c.id,
        username: c.username,
        fullName: c.fullName,
        kind: c.kind,
        paused: c.paused,
        tags: c.tags,
        igUserId: c.igUserId,
        conversationId: c.zernioConversationId,
        theirLastAt: rec?.their_last_at ?? null,
        ourLastAt: rec?.our_last_at ?? null,
        setterStage: c.setterStage,
        stage: c.stage,
        notes: c.notes,
        fields: values.filter((v) => v.contactId === c.id && v.value.trim()).map((v) => ({ label: v.field.label, value: v.value })),
      };
    });
}

const dbStore: BroadcastStore = {
  async list(workspaceId) {
    return (await prisma.broadcast.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } })).map(broadcastView);
  },
  async get(workspaceId, key) {
    const b = await prisma.broadcast.findUnique({ where: { workspaceId_key: { workspaceId, key } } });
    return b ? broadcastView(b) : null;
  },
  async getById(id) {
    const b = await prisma.broadcast.findUnique({ where: { id } });
    return b ? { ...broadcastView(b), workspaceId: b.workspaceId } : null;
  },
  async update(workspaceId, id, patch) {
    await prisma.broadcast.updateMany({ where: { id, workspaceId }, data: patch });
    return broadcastView(await prisma.broadcast.findUniqueOrThrow({ where: { id } }));
  },
  async getRun(broadcastId, runDate) {
    const r = await prisma.broadcastRun.findUnique({ where: { broadcastId_runDate: { broadcastId, runDate } } });
    return r ? runView(r) : null;
  },
  async getRunById(runId) {
    const r = await prisma.broadcastRun.findUnique({ where: { id: runId } });
    return r ? runView(r) : null;
  },
  async latestRuns(broadcastId, take) {
    return (await prisma.broadcastRun.findMany({ where: { broadcastId }, orderBy: { runDate: "desc" }, take })).map(runView);
  },
  async createRun(broadcastId, runDate, link) {
    const r = await prisma.broadcastRun.upsert({
      where: { broadcastId_runDate: { broadcastId, runDate } },
      create: { broadcastId, runDate, link, status: "drafting" },
      update: { link },
    });
    return runView(r);
  },
  async updateRun(runId, patch) {
    await prisma.broadcastRun.update({ where: { id: runId }, data: patch });
  },
  async messages(runId) {
    return (await prisma.broadcastMessage.findMany({ where: { runId }, orderBy: [{ scheduledAt: "asc" }, { id: "asc" }] })).map(messageView);
  },
  async getMessage(id) {
    const m = await prisma.broadcastMessage.findUnique({ where: { id } });
    return m ? { ...messageView(m), runId: m.runId, workspaceId: m.workspaceId } : null;
  },
  async upsertMessage(runId, workspaceId, contactId, data) {
    const m = await prisma.broadcastMessage.upsert({
      where: { runId_contactId: { runId, contactId } },
      create: { runId, workspaceId, contactId, bubbles: [], followupBubbles: [], ...messageData(data) },
      update: messageData(data),
    });
    return messageView(m);
  },
  async updateMessage(id, patch) {
    await prisma.broadcastMessage.update({ where: { id }, data: messageData(patch) });
  },
  async rows(workspaceId, opts) {
    const rows = await prisma.broadcastMessage.findMany({
      where: { workspaceId, ...(opts.statuses ? { status: { in: opts.statuses } } : {}), ...(opts.contactId ? { contactId: opts.contactId } : {}) },
      include: { run: { include: { broadcast: { select: { key: true, name: true } } } } },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
      take: opts.take ?? 200,
    });
    return rows.map((m) => ({ ...messageView(m), runId: m.runId, runDate: m.run.runDate, broadcastKey: m.run.broadcast.key, broadcastName: m.run.broadcast.name }));
  },
  async taggedContacts(workspaceId, tag) {
    return loadContacts({ workspaceId, tags: { has: tag } });
  },
  async contact(workspaceId, contactId) {
    return (await loadContacts({ workspaceId, id: contactId }))[0] ?? null;
  },
  async setTag(workspaceId, contactId, tag, on) {
    const c = await prisma.contact.findFirst({ where: { id: contactId, workspaceId }, select: { tags: true } });
    if (!c) return;
    const has = c.tags.includes(tag);
    if (has === on) return;
    await prisma.contact.update({ where: { id: contactId }, data: { tags: on ? [...c.tags, tag] : c.tags.filter((t) => t !== tag) } });
  },
};

export function broadcastStore(): BroadcastStore {
  return osMockEnabled() ? mockBroadcastStore() : dbStore;
}
