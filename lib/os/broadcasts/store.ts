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
  BroadcastStatus,
  BroadcastView,
} from "@/lib/os/broadcasts/types";
import { BROADCAST_STATUSES, bubblesLink, parseBubbles } from "@/lib/os/broadcasts/types";

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

/** A Broadcast row as Prisma returns it, plus its audience tag's name. */
type BroadcastRow = {
  id: string;
  key: string;
  name: string;
  audienceTagId: string | null;
  contactIds: string[];
  status: string;
  startMode: string;
  sendDate: string | null;
  bubbles: unknown;
  personaliseMode: string;
  variations: unknown;
  duplicatedFromId: string | null;
  template: string;
  followupTemplate: string | null;
  followupDelayMin: number;
  windowStart: string;
  windowEnd: string;
  timezone: string;
  setterId: string | null;
};

function weekdayOf(date: string | null): number {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return 5;
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

const asStatus = (v: string): BroadcastStatus => ((BROADCAST_STATUSES as readonly string[]).includes(v) ? (v as BroadcastStatus) : "draft");

export function broadcastView(b: BroadcastRow, audienceTag = ""): BroadcastView {
  const bubbles = parseBubbles(b.bubbles);
  const status = asStatus(b.status);
  return {
    id: b.id,
    key: b.key,
    name: b.name,
    audienceTag,
    audienceTagId: b.audienceTagId,
    contactIds: b.contactIds ?? [],
    status,
    startMode: b.startMode === "now" ? "now" : "window",
    sendDate: b.sendDate,
    bubbles,
    personaliseMode: b.personaliseMode === "variations" || b.personaliseMode === "as_written" ? b.personaliseMode : "per_person",
    variations: Array.isArray(b.variations) ? (b.variations as unknown[]).map((v) => (Array.isArray(v) ? v.map(String) : [])) : [],
    duplicatedFromId: b.duplicatedFromId,
    link: bubblesLink(bubbles),
    template: b.template,
    followupTemplate: b.followupTemplate,
    followupDelayMin: b.followupDelayMin,
    windowDay: weekdayOf(b.sendDate),
    windowStart: b.windowStart,
    windowEnd: b.windowEnd,
    timezone: b.timezone,
    setterId: b.setterId,
    enabled: status !== "draft" && status !== "cancelled",
  };
}

/** Tag names by id for a few broadcasts (the audience is stored by id). */
async function tagNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((v): v is string => !!v))];
  if (!want.length) return new Map();
  const rows = await prisma.tag.findMany({ where: { id: { in: want } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function views<T extends BroadcastRow>(rows: T[]): Promise<(BroadcastView & { workspaceId?: string })[]> {
  const names = await tagNames(rows.map((r) => r.audienceTagId));
  return rows.map((r) => broadcastView(r, r.audienceTagId ? (names.get(r.audienceTagId) ?? "") : ""));
}

/** A view patch as columns: the legacy derived fields write through to the
 *  new shape (link → the link bubble) or are dropped (windowDay, enabled). */
async function broadcastData(workspaceId: string, id: string, patch: BroadcastPatch): Promise<Record<string, unknown>> {
  const { audienceTag, link, windowDay: _day, enabled: _on, bubbles, variations, ...rest } = patch;
  void _day;
  void _on;
  const data: Record<string, unknown> = { ...rest };
  if (bubbles !== undefined) data.bubbles = bubbles;
  if (variations !== undefined) data.variations = variations;
  if (link !== undefined && bubbles === undefined) {
    const cur = await prisma.broadcast.findFirst({ where: { id, workspaceId }, select: { bubbles: true } });
    const list = parseBubbles(cur?.bubbles);
    const i = list.findIndex((b) => b.type === "link");
    if (i >= 0) list[i] = { type: "link", url: link, resourceId: null };
    else list.push({ type: "link", url: link, resourceId: null });
    data.bubbles = list;
  }
  if (audienceTag !== undefined && patch.audienceTagId === undefined) {
    const { resolveTag } = await import("@/lib/os/tags/store");
    data.audienceTagId = audienceTag ? ((await resolveTag(workspaceId, audienceTag))?.id ?? null) : null;
  }
  return data;
}

function runView(r: { id: string; broadcastId: string; runDate: string; link: string | null; status: string; createdAt: Date }): BroadcastRunView {
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
    const inRun = await (await import("@/lib/os/workflows/hooks")).liveRunContacts(rows.map((r) => r.id));
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
        inWorkflow: inRun.has(c.id),
      };
    });
}

const dbStore: BroadcastStore = {
  async list(workspaceId) {
    return views(await prisma.broadcast.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } }));
  },
  async get(workspaceId, key) {
    const b = await prisma.broadcast.findUnique({ where: { workspaceId_key: { workspaceId, key } } });
    return b ? (await views([b]))[0] : null;
  },
  async getById(id) {
    const b = await prisma.broadcast.findUnique({ where: { id } });
    return b ? { ...(await views([b]))[0], workspaceId: b.workspaceId } : null;
  },
  async update(workspaceId, id, patch) {
    await prisma.broadcast.updateMany({ where: { id, workspaceId }, data: await broadcastData(workspaceId, id, patch) });
    return (await views([await prisma.broadcast.findUniqueOrThrow({ where: { id } })]))[0];
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
    if (!tag) return [];
    return loadContacts({ workspaceId, tags: { has: tag } });
  },
  async contact(workspaceId, contactId) {
    return (await loadContacts({ workspaceId, id: contactId }))[0] ?? null;
  },
  async setTag(workspaceId, contactId, tag, on) {
    const { addTag, removeTag } = await import("@/lib/os/fields/write");
    await (on ? addTag : removeTag)({ workspaceId, contactId, tag, source: "kevin" });
  },
};

export function broadcastStore(): BroadcastStore {
  return osMockEnabled() ? mockBroadcastStore() : dbStore;
}
