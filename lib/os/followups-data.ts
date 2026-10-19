// IO for the Follow-ups screen: loads the rows lib/os/followups.ts selects
// from, and the writes (snooze, skip, Friday flag, Friday send). With
// OS_MOCK=1 everything runs on the sample inbox (lib/os/mock.ts) in memory.
//
// Approve-only: the Friday send runs only from a person pressing Send (one
// row, or a batch they confirmed). J's nudges go out through approveDraft.

import { fridayTags } from "@/lib/os/broadcasts/migrate";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import {
  DEFAULT_FRIDAY_NOTE,
  dueCount,
  fridayFor,
  isFriday,
  selectFriday,
  selectNudges,
  SOON_HOURS,
  type FridayContact,
  type FridayItem,
  type FridayResource,
  type FridaySendLog,
  type NudgeItem,
  type QueueContact,
} from "@/lib/os/followups";
import { appendMockMessage, mockContactExtras, mockThreads, osMockEnabled, updateMockContact } from "@/lib/os/mock";
import { getSetterConfig } from "@/lib/os/setter/config";
import { iso, newRecord, type SetterRecord } from "@/lib/os/setter/state";
import { setterStore, type DraftView } from "@/lib/os/setter/store";

const HOUR = 3600_000;

export interface FollowupsData {
  nudges: NudgeItem[];
  friday: {
    /** "YYYY-MM-DD" of this (or the next) Friday. */
    date: string;
    isToday: boolean;
    items: FridayItem[];
    /** Active resources with a link, in catalog order. */
    resources: FridayResource[];
  };
  defaultNote: string;
}

// ---------------------------------------------------------------- sample data
interface MockFollowups {
  seeded: boolean;
  snoozed: Map<string, string>;
  sends: (FridaySendLog & { id: string })[];
}

const mockFu: MockFollowups = ((globalThis as { __osMockFollowups?: MockFollowups }).__osMockFollowups ??= {
  seeded: false,
  snoozed: new Map(),
  sends: [],
});

const MOCK_RESOURCES: FridayResource[] = [
  { id: "r1", slug: "claude-starter", name: "Claude starter kit", link: "https://example.com/claude-starter", status: "ACTIVE" },
  { id: "r2", slug: "dm-scripts", name: "DM scripts pack", link: "https://example.com/dm-scripts", status: "ACTIVE" },
  { id: "r3", slug: "content-os", name: "Content OS template", link: "https://example.com/content-os", status: "ACTIVE" },
  { id: "r4", slug: "voice-notes", name: "Voice note playbook", link: null, status: "TEST" },
];

const ago = (h: number) => new Date(Date.now() - h * HOUR);

/** One-time sample state: a value opener due, and two quiet threads the
 *  follow-up sequences pick up (lib/os/sequences/mock-seed.ts). */
export async function seedFollowupsMock() {
  if (mockFu.seeded) return;
  mockFu.seeded = true;
  const store = setterStore();
  const threads = new Map(mockThreads().map((t) => [t.contact?.id, t]));
  const put = async (id: string, edit: (r: SetterRecord) => void) => {
    const t = threads.get(id);
    if (!t) return;
    const rec = newRecord(t.conversationId, t.username ?? "", id);
    rec.their_last_at = iso(t.updatedTime ? new Date(t.updatedTime) : null);
    edit(rec);
    const c = await store.getContact(id, "mock");
    if (c) await store.saveState(c, rec);
  };

  // tom.k: got the lead magnet 70 minutes ago, the value opener is due.
  await put("c2", (r) => {
    r.state = "delivered";
    r.entry = { via: "story_keyword", slug: "claude-starter", keyword: "starter", at: iso(ago(1.3)) };
    r.delivered_at = iso(ago(1.2));
    r.our_last_at = r.delivered_at;
    r.resources_sent = ["claude-starter"];
    r.next_action = { kind: "value_opener", at: iso(ago(0.7)) };
  });
  // sam.creates: we wrote last 21h ago and they went quiet mid-qualifying:
  // the no-reply sequence's first step (value first) is due.
  appendMockMessage("m8", "makes sense. what's the bit that eats most of your week right now?", ago(21));
  await put("c8", (r) => {
    r.state = "in_conversation";
    r.stage = "qualify";
    r.our_last_at = iso(ago(21));
    r.resources_sent = ["claude-starter"];
  });
  // jordan.ops: we offered the call an hour ago; "after the invite" is queued.
  appendMockMessage("m3", "it'd be a 20 min call, I'd map your current DM flow and show where it leaks", ago(1));
  await put("c3", (r) => {
    r.state = "in_conversation";
    r.stage = "bridge";
    r.our_last_at = iso(ago(1));
    r.invited = { route: "call", offer: null, at: iso(ago(1))! };
  });
}

async function mockQueueContacts(): Promise<QueueContact[]> {
  const store = setterStore();
  const out: QueueContact[] = [];
  for (const t of mockThreads()) {
    if (!t.contact) continue;
    const rec = await store.loadState(t.contact.id);
    out.push({
      contactId: t.contact.id,
      username: t.username,
      fullName: t.fullName ?? null,
      avatarUrl: t.avatarUrl ?? null,
      conversationId: t.conversationId,
      kind: t.contact.kind,
      paused: t.contact.paused,
      tags: mockContactExtras(t.contact.id).tags,
      state: rec?.state ?? null,
      nextActionKind: rec && rec.next_action.kind !== "none" ? rec.next_action.kind : null,
      nextActionAt: rec?.next_action.at ?? null,
      snoozedUntil: mockFu.snoozed.get(t.contact.id) ?? null,
      record: rec,
    });
  }
  return out;
}

async function mockFridayContacts(): Promise<FridayContact[]> {
  const store = setterStore();
  const out: FridayContact[] = [];
  for (const t of mockThreads()) {
    if (!t.contact?.onFriday) continue;
    const rec = await store.loadState(t.contact.id);
    out.push({
      contactId: t.contact.id,
      username: t.username,
      fullName: t.fullName ?? null,
      avatarUrl: t.avatarUrl ?? null,
      conversationId: t.conversationId,
      tags: mockContactExtras(t.contact.id).tags,
      state: rec?.state ?? null,
      record: rec,
      theirLastAt: t.updatedTime,
    });
  }
  return out;
}

// ---------------------------------------------------------------- Postgres reads
type ContactWithState = Prisma.ContactGetPayload<{ include: { setterState: true } }>;

function queueContact(c: ContactWithState): QueueContact {
  const s = c.setterState;
  return {
    contactId: c.id,
    username: c.username,
    fullName: c.fullName,
    avatarUrl: c.avatarUrl,
    conversationId: c.zernioConversationId,
    kind: c.kind,
    paused: c.paused,
    tags: c.tags,
    state: s?.state ?? null,
    nextActionKind: s?.nextActionKind ?? null,
    nextActionAt: s?.nextActionAt?.toISOString() ?? null,
    snoozedUntil: s?.snoozedUntil?.toISOString() ?? null,
    record: (s?.record as unknown as SetterRecord) ?? null,
  };
}

async function dbQueueContacts(workspaceId: string, drafts: DraftView[], now: Date): Promise<QueueContact[]> {
  const horizon = new Date(now.getTime() + SOON_HOURS * HOUR);
  const timed = await prisma.setterState.findMany({
    where: { workspaceId, nextActionKind: { in: ["nudge", "value_opener"] }, nextActionAt: { lte: horizon } },
    select: { contactId: true },
    take: 500,
  });
  const ids = [...new Set([...timed.map((s) => s.contactId), ...drafts.filter((d) => d.kind === "nudge" || d.kind === "value_opener").map((d) => d.contactId)])];
  if (!ids.length) return [];
  const rows = await prisma.contact.findMany({ where: { id: { in: ids }, workspaceId }, include: { setterState: true } });
  return rows.map(queueContact);
}

function dbResources(workspaceId: string) {
  return prisma.resource.findMany({
    where: { workspaceId, kind: "resource" },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

async function dbFriday(workspaceId: string) {
  const [rows, resources] = await Promise.all([
    prisma.contact.findMany({
      where: { workspaceId, onFriday: true },
      include: { setterState: true, fridaySends: true },
      orderBy: { fridayAddedAt: "asc" },
      take: 500,
    }),
    dbResources(workspaceId),
  ]);
  const contacts: FridayContact[] = rows.map((c) => ({
    contactId: c.id,
    username: c.username,
    fullName: c.fullName,
    avatarUrl: c.avatarUrl,
    conversationId: c.zernioConversationId,
    tags: c.tags,
    state: c.setterState?.state ?? null,
    record: (c.setterState?.record as unknown as SetterRecord) ?? null,
  }));
  const sends: FridaySendLog[] = rows.flatMap((c) =>
    c.fridaySends.map((s) => ({ contactId: c.id, resourceSlug: s.resourceSlug, friday: s.friday, status: s.status, sentAt: s.sentAt?.toISOString() ?? null }))
  );
  return { contacts, sends, resources: resources.map((r) => ({ id: r.id, slug: r.slug, name: r.name, link: r.link, status: r.status })) };
}

// ---------------------------------------------------------------- the screen
export async function loadFollowups(workspaceId: string, now: Date = new Date()): Promise<FollowupsData> {
  const cfg = getSetterConfig();
  const store = setterStore();
  const date = fridayFor(now);
  let queue: QueueContact[];
  let friday: { contacts: FridayContact[]; sends: FridaySendLog[]; resources: FridayResource[] };
  const drafts = await store.listPending(workspaceId);

  if (osMockEnabled()) {
    await seedFollowupsMock();
    queue = await mockQueueContacts();
    friday = { contacts: await mockFridayContacts(), sends: mockFu.sends, resources: MOCK_RESOURCES };
  } else {
    [queue, friday] = await Promise.all([dbQueueContacts(workspaceId, drafts, now), dbFriday(workspaceId)]);
  }
  // Drafts again after the mock seed wrote one.
  const pending = osMockEnabled() ? await store.listPending(workspaceId) : drafts;

  return {
    nudges: selectNudges(queue, pending, now, { cfg }),
    friday: {
      date,
      isToday: isFriday(now),
      items: selectFriday(friday.contacts, friday.resources, friday.sends, now, { friday: date, cfg }),
      resources: friday.resources.filter((r) => r.status === "ACTIVE" && r.link),
    },
    defaultNote: DEFAULT_FRIDAY_NOTE,
  };
}

/** The sidebar number: J's nudges ready or due, follow-up steps waiting,
 *  calls to mark and tasks, and broadcasts that need a link or a review.
 *  (The old per-person Friday list is now the Follow-up Friday broadcast.) */
export async function followupsDue(workspaceId: string, now: Date = new Date()): Promise<number> {
  const data = await loadFollowups(workspaceId, now);
  // Lazy: the sequences view seeds its samples from this module.
  const { followupAttentionCount } = await import("@/lib/os/sequences/view");
  const { broadcastNeeds } = await import("@/lib/os/broadcasts/engine");
  const [sequences, needs] = await Promise.all([followupAttentionCount(workspaceId, now).catch(() => 0), broadcastNeeds(workspaceId, { now }).catch(() => [])]);
  return dueCount(data.nudges, [], false) + sequences + needs.length;
}

/** Add to / take off the Friday list. */
export async function setFriday(workspaceId: string, contactIds: string[], on: boolean): Promise<{ count: number }> {
  if (osMockEnabled()) {
    const ids = mockThreads().flatMap((t) => (t.contact && contactIds.includes(t.contact.id) ? [t.contact.id] : []));
    for (const id of ids) updateMockContact(id, { onFriday: on });
    return { count: ids.length };
  }
  const r = await prisma.contact.updateMany({
    where: { id: { in: contactIds }, workspaceId },
    data: { onFriday: on, fridayAddedAt: on ? new Date() : null },
  });
  // Broadcasts read the follow-up-friday tag; keep it in step with the flag.
  const rows = await prisma.contact.findMany({ where: { id: { in: contactIds }, workspaceId }, select: { id: true, tags: true } });
  for (const row of rows) await prisma.contact.update({ where: { id: row.id }, data: { tags: fridayTags(row.tags, on) } });
  return { count: r.count };
}
