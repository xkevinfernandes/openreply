// Where broadcasts live: Broadcast, BroadcastRun (at most one per broadcast),
// BroadcastMessage, and the contacts the audience reads. Postgres, or memory
// with OS_MOCK=1 (lib/os/mock-followups.ts).

import { prisma } from "@/lib/db/client";
import { osMockEnabled } from "@/lib/os/mock";
import { mockBroadcastStore } from "@/lib/os/mock-followups";
import type {
  BroadcastBubble,
  BroadcastContact,
  BroadcastMessageRow,
  BroadcastMessageStatus,
  BroadcastMessageView,
  BroadcastRunStatus,
  BroadcastRunView,
  BroadcastStatus,
  BroadcastView,
  SkipReason,
} from "@/lib/os/broadcasts/types";
import { BROADCAST_STATUSES, parseBubbles, parseVariations } from "@/lib/os/broadcasts/types";

/** What can change on a broadcast (the tag name is read, never written). */
export type BroadcastPatch = Partial<Omit<BroadcastView, "id" | "audienceTag" | "createdAt">>;
export type BroadcastCreate = Omit<BroadcastPatch, "key" | "name"> & { key: string; name: string };

export interface MessagePatch {
  bubbles?: string[];
  followupBubbles?: string[];
  status?: BroadcastMessageStatus;
  edited?: boolean;
  scheduledAt?: string | null;
  sentAt?: string | null;
  error?: string | null;
  reasoning?: string | null;
  leftOutReason?: string | null;
  includedAnyway?: boolean;
  skipReason?: SkipReason | null;
  sentLinks?: string[];
}

export interface RunPatch {
  status?: BroadcastRunStatus;
  runDate?: string;
  /** Drafts (re)made at. */
  createdAt?: string;
}

/** A message someone was sent (or Kevin sent himself), for the link guard. */
export interface SentTrace {
  broadcastId: string;
  contactId: string;
  bubbles: string[];
  sentLinks: string[];
  at: string | null;
}

export interface BroadcastStore {
  /** Newest first. */
  list(workspaceId: string): Promise<BroadcastView[]>;
  get(workspaceId: string, key: string): Promise<BroadcastView | null>;
  getById(id: string): Promise<(BroadcastView & { workspaceId: string }) | null>;
  create(workspaceId: string, data: BroadcastCreate): Promise<BroadcastView>;
  update(workspaceId: string, id: string, patch: BroadcastPatch): Promise<BroadcastView>;
  /** The broadcast's run (at most one). */
  runOf(broadcastId: string): Promise<BroadcastRunView | null>;
  getRunById(runId: string): Promise<BroadcastRunView | null>;
  createRun(broadcastId: string, runDate: string): Promise<BroadcastRunView>;
  updateRun(runId: string, patch: RunPatch): Promise<void>;
  messages(runId: string): Promise<BroadcastMessageView[]>;
  getMessage(id: string): Promise<(BroadcastMessageView & { runId: string; workspaceId: string }) | null>;
  /** Create or replace the run's message for a contact. */
  upsertMessage(runId: string, workspaceId: string, contactId: string, data: MessagePatch): Promise<BroadcastMessageView>;
  updateMessage(id: string, patch: MessagePatch): Promise<void>;
  /** Messages with their run and broadcast. */
  rows(workspaceId: string, opts: { statuses?: BroadcastMessageStatus[]; contactId?: string; take?: number }): Promise<BroadcastMessageRow[]>;
  /** Sent messages and Send-myself links in other broadcasts (the link guard). */
  sentTraces(workspaceId: string, exceptBroadcastId: string): Promise<SentTrace[]>;
  /** Contacts carrying a tag (by name), with what J knows about them. No cap on the count. */
  taggedContacts(workspaceId: string, tag: string): Promise<BroadcastContact[]>;
  /** A fixed list ("New broadcast to these N"). */
  contactsByIds(workspaceId: string, ids: string[]): Promise<BroadcastContact[]>;
  /** One contact, fresh (send-time re-checks). */
  contact(workspaceId: string, contactId: string): Promise<BroadcastContact | null>;
  setTag(workspaceId: string, contactId: string, tag: string, on: boolean): Promise<void>;
}

/** A Broadcast row as Prisma returns it. */
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
  followupTemplate: string | null;
  followupDelayMin: number;
  windowStart: string;
  windowEnd: string;
  timezone: string;
  setterId: string | null;
  createdAt: Date;
};

const asStatus = (v: string): BroadcastStatus => ((BROADCAST_STATUSES as readonly string[]).includes(v) ? (v as BroadcastStatus) : "draft");

export function broadcastView(b: BroadcastRow, audienceTag = ""): BroadcastView {
  return {
    id: b.id,
    key: b.key,
    name: b.name,
    audienceTag,
    audienceTagId: b.audienceTagId,
    contactIds: b.contactIds ?? [],
    status: asStatus(b.status),
    startMode: b.startMode === "now" ? "now" : "window",
    sendDate: b.sendDate,
    bubbles: parseBubbles(b.bubbles),
    personaliseMode: b.personaliseMode === "variations" || b.personaliseMode === "as_written" ? b.personaliseMode : "per_person",
    variations: parseVariations(b.variations),
    duplicatedFromId: b.duplicatedFromId,
    followupTemplate: b.followupTemplate,
    followupDelayMin: b.followupDelayMin,
    windowStart: b.windowStart,
    windowEnd: b.windowEnd,
    timezone: b.timezone,
    setterId: b.setterId,
    createdAt: b.createdAt.toISOString(),
  };
}

/** Tag names by id (the audience is stored by id). */
async function tagNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((v): v is string => !!v))];
  if (!want.length) return new Map();
  const rows = await prisma.tag.findMany({ where: { id: { in: want } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function views(rows: BroadcastRow[]): Promise<BroadcastView[]> {
  const names = await tagNames(rows.map((r) => r.audienceTagId));
  return rows.map((r) => broadcastView(r, r.audienceTagId ? (names.get(r.audienceTagId) ?? "") : ""));
}

/** A patch as columns (bubbles and variations are JSON). */
function broadcastData(patch: BroadcastPatch): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) data[k] = v;
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
  leftOutReason: string | null;
  includedAnyway: boolean;
  skipReason: string | null;
  sentLinks: string[];
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
    leftOutReason: m.leftOutReason,
    includedAnyway: m.includedAnyway,
    skipReason: (m.skipReason as SkipReason | null) ?? null,
    sentLinks: m.sentLinks,
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
    ...(p.leftOutReason !== undefined ? { leftOutReason: p.leftOutReason } : {}),
    ...(p.includedAnyway !== undefined ? { includedAnyway: p.includedAnyway } : {}),
    ...(p.skipReason !== undefined ? { skipReason: p.skipReason } : {}),
    ...(p.sentLinks ? { sentLinks: p.sentLinks } : {}),
  };
}

type ContactWhere = { workspaceId: string; id?: string | { in: string[] }; tags?: { has: string } };

async function loadContacts(where: ContactWhere): Promise<BroadcastContact[]> {
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
      archivedAt: true,
      spam: true,
      spamOverride: true,
      lastInboundAt: true,
      setterState: { select: { record: true } },
    },
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
      archived: Boolean(c.archivedAt),
      spam: c.spamOverride ?? c.spam,
      lastInboundAt: c.lastInboundAt?.toISOString() ?? null,
    };
  });
}

const dbStore: BroadcastStore = {
  async list(workspaceId) {
    return views(await prisma.broadcast.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } }));
  },
  async get(workspaceId, key) {
    const b = await prisma.broadcast.findUnique({ where: { workspaceId_key: { workspaceId, key } } });
    return b ? (await views([b]))[0] : null;
  },
  async getById(id) {
    const b = await prisma.broadcast.findUnique({ where: { id } });
    return b ? { ...(await views([b]))[0], workspaceId: b.workspaceId } : null;
  },
  async create(workspaceId, data) {
    const b = await prisma.broadcast.create({ data: { workspaceId, ...(broadcastData(data) as { key: string; name: string }) } });
    return (await views([b]))[0];
  },
  async update(workspaceId, id, patch) {
    await prisma.broadcast.updateMany({ where: { id, workspaceId }, data: broadcastData(patch) });
    return (await views([await prisma.broadcast.findUniqueOrThrow({ where: { id } })]))[0];
  },
  async runOf(broadcastId) {
    const r = await prisma.broadcastRun.findFirst({ where: { broadcastId }, orderBy: { createdAt: "desc" } });
    return r ? runView(r) : null;
  },
  async getRunById(runId) {
    const r = await prisma.broadcastRun.findUnique({ where: { id: runId } });
    return r ? runView(r) : null;
  },
  async createRun(broadcastId, runDate) {
    return runView(await prisma.broadcastRun.create({ data: { broadcastId, runDate, link: null, status: "drafting" } }));
  },
  async updateRun(runId, patch) {
    await prisma.broadcastRun.update({
      where: { id: runId },
      data: { ...(patch.status ? { status: patch.status } : {}), ...(patch.runDate ? { runDate: patch.runDate } : {}), ...(patch.createdAt ? { createdAt: new Date(patch.createdAt) } : {}) },
    });
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
  async sentTraces(workspaceId, exceptBroadcastId) {
    const rows = await prisma.broadcastMessage.findMany({
      where: { workspaceId, run: { broadcastId: { not: exceptBroadcastId } }, OR: [{ status: "sent" }, { sentLinks: { isEmpty: false } }] },
      select: { contactId: true, bubbles: true, sentLinks: true, status: true, sentAt: true, run: { select: { broadcastId: true } } },
    });
    return rows.map((r) => ({ broadcastId: r.run.broadcastId, contactId: r.contactId, bubbles: r.status === "sent" ? r.bubbles : [], sentLinks: r.sentLinks, at: r.sentAt?.toISOString() ?? null }));
  },
  async taggedContacts(workspaceId, tag) {
    if (!tag) return [];
    return loadContacts({ workspaceId, tags: { has: tag } });
  },
  async contactsByIds(workspaceId, ids) {
    if (!ids.length) return [];
    return loadContacts({ workspaceId, id: { in: ids } });
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

export type { BroadcastBubble };
