// Broadcasts in memory: the OS_MOCK=1 sample (a kept weekly draft, a sent
// Follow-up Friday, one in review with drafts, a new draft) and the store the
// tests drive. On globalThis so server actions and pages share it; gone on
// restart.
//
// The sample contacts' "last message" times hang off the in-review
// broadcast's window start, so Who shows people inside and outside the 24h
// window whatever day the demo runs.

import type { BroadcastCreate, BroadcastPatch, BroadcastStore, MessagePatch, RunPatch } from "@/lib/os/broadcasts/store";
import { nextRunDate, windowBounds, zonedInstant } from "@/lib/os/broadcasts/schedule";
import { asWritten } from "@/lib/os/broadcasts/oneoff";
import { MOCK_LEAD_MAGNETS } from "@/lib/os/mock-resources";
import { localDate } from "@/lib/os/sending/cap";
import {
  FOLLOW_UP_FRIDAY,
  type BroadcastBubble,
  type BroadcastContact,
  type BroadcastMessageView,
  type BroadcastRunView,
  type BroadcastView,
} from "@/lib/os/broadcasts/types";
import { mockContactExtras, mockThreads } from "@/lib/os/mock";
import { mockCrmState } from "@/lib/os/mock-crm";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const LUX = "Europe/Luxembourg";

type StoredBroadcast = BroadcastView & { workspaceId: string };
type StoredMessage = BroadcastMessageView & { runId: string; workspaceId: string };

export interface MemoryBroadcasts {
  broadcasts: StoredBroadcast[];
  runs: BroadcastRunView[];
  messages: StoredMessage[];
  tags: Map<string, Set<string>>;
  seq: number;
  seeded: Set<string>;
}

export interface MemoryStoreOptions {
  /** Every contact the store knows (tags included). */
  contacts: (mem: MemoryBroadcasts) => BroadcastContact[];
  /** A tag id's name (the audience is stored by id). */
  tagName?: (id: string) => string;
  /** Fills a workspace the first time it is read. */
  seed?: (mem: MemoryBroadcasts, workspaceId: string, next: (prefix: string) => string) => void;
}

const clean = <T extends object>(p: T) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as Partial<T>;

/** A broadcast store in memory (the mock and the tests). */
export function createMemoryBroadcastStore(opts: MemoryStoreOptions, mem: MemoryBroadcasts = newMemory()): BroadcastStore & { mem: MemoryBroadcasts } {
  const next = (prefix: string) => {
    mem.seq += 1;
    return `${prefix}${mem.seq}`;
  };
  const seed = (workspaceId: string) => {
    if (mem.seeded.has(workspaceId)) return;
    mem.seeded.add(workspaceId);
    opts.seed?.(mem, workspaceId, next);
  };
  const viewOf = (b: StoredBroadcast): BroadcastView => {
    const v: BroadcastView & { workspaceId?: string } = { ...b, bubbles: b.bubbles.map((x) => ({ ...x })), variations: b.variations.map((x) => [...x]), contactIds: [...b.contactIds] };
    delete v.workspaceId;
    return v;
  };
  const contacts = () => opts.contacts(mem);

  return {
    mem,
    async list(workspaceId) {
      seed(workspaceId);
      return mem.broadcasts
        .filter((b) => b.workspaceId === workspaceId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(viewOf);
    },
    async get(workspaceId, key) {
      seed(workspaceId);
      const b = mem.broadcasts.find((x) => x.workspaceId === workspaceId && x.key === key);
      return b ? viewOf(b) : null;
    },
    async getById(id) {
      const b = mem.broadcasts.find((x) => x.id === id);
      return b ? { ...viewOf(b), workspaceId: b.workspaceId } : null;
    },
    async create(workspaceId, data: BroadcastCreate) {
      seed(workspaceId);
      if (mem.broadcasts.some((b) => b.workspaceId === workspaceId && b.key === data.key)) throw new Error("That key is taken.");
      const b: StoredBroadcast = {
        ...blank(),
        ...clean(data),
        key: data.key,
        name: data.name,
        id: next("bc"),
        workspaceId,
        audienceTag: data.audienceTagId ? (opts.tagName?.(data.audienceTagId) ?? "") : "",
        createdAt: new Date(Date.now() + mem.seq).toISOString(),
      };
      mem.broadcasts.push(b);
      return viewOf(b);
    },
    async update(workspaceId, id, patch: BroadcastPatch) {
      const b = mem.broadcasts.find((x) => x.id === id && x.workspaceId === workspaceId);
      if (!b) throw new Error("Broadcast not found.");
      Object.assign(b, clean(patch));
      if (patch.audienceTagId !== undefined) b.audienceTag = patch.audienceTagId ? (opts.tagName?.(patch.audienceTagId) ?? "") : "";
      return viewOf(b);
    },
    async runOf(broadcastId) {
      const r = mem.runs.filter((x) => x.broadcastId === broadcastId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return r ? { ...r } : null;
    },
    async getRunById(runId) {
      const r = mem.runs.find((x) => x.id === runId);
      return r ? { ...r } : null;
    },
    async createRun(broadcastId, runDate) {
      const run: BroadcastRunView = { id: next("run"), broadcastId, runDate, link: null, status: "drafting", createdAt: new Date().toISOString() };
      mem.runs.push(run);
      return { ...run };
    },
    async updateRun(runId, patch: RunPatch) {
      const r = mem.runs.find((x) => x.id === runId);
      if (r) Object.assign(r, clean(patch));
    },
    async messages(runId) {
      return mem.messages
        .filter((m) => m.runId === runId)
        .sort((a, b) => (a.scheduledAt ?? "~").localeCompare(b.scheduledAt ?? "~") || a.id.localeCompare(b.id, undefined, { numeric: true }))
        .map(copyMessage);
    },
    async getMessage(id) {
      const m = mem.messages.find((x) => x.id === id);
      return m ? copyMessage(m) : null;
    },
    async upsertMessage(runId, workspaceId, contactId, data: MessagePatch) {
      let m = mem.messages.find((x) => x.runId === runId && x.contactId === contactId);
      if (!m) {
        m = { ...blankMessage(), id: next("bm"), runId, workspaceId, contactId };
        mem.messages.push(m);
      }
      Object.assign(m, clean(data));
      return copyMessage(m);
    },
    async updateMessage(id, patch) {
      const m = mem.messages.find((x) => x.id === id);
      if (m) Object.assign(m, clean(patch));
    },
    async rows(workspaceId, o) {
      seed(workspaceId);
      return mem.messages
        .filter((m) => m.workspaceId === workspaceId && (!o.statuses || o.statuses.includes(m.status)) && (!o.contactId || m.contactId === o.contactId))
        .flatMap((m) => {
          const run = mem.runs.find((r) => r.id === m.runId);
          const b = run ? mem.broadcasts.find((x) => x.id === run.broadcastId) : null;
          return run && b ? [{ ...copyMessage(m), runDate: run.runDate, broadcastKey: b.key, broadcastName: b.name }] : [];
        })
        .sort((a, b) => (a.scheduledAt ?? "~").localeCompare(b.scheduledAt ?? "~"))
        .slice(0, o.take ?? 200);
    },
    async sentTraces(workspaceId, exceptBroadcastId) {
      seed(workspaceId);
      return mem.messages.flatMap((m) => {
        const run = mem.runs.find((r) => r.id === m.runId);
        if (!run || run.broadcastId === exceptBroadcastId || m.workspaceId !== workspaceId) return [];
        if (m.status !== "sent" && !(m.sentLinks ?? []).length) return [];
        return [{ broadcastId: run.broadcastId, contactId: m.contactId, bubbles: m.status === "sent" ? [...m.bubbles] : [], sentLinks: [...(m.sentLinks ?? [])], at: m.sentAt }];
      });
    },
    async taggedContacts(workspaceId, tag) {
      seed(workspaceId);
      if (!tag) return [];
      return contacts().filter((c) => c.tags.includes(tag));
    },
    async contactsByIds(workspaceId, ids) {
      seed(workspaceId);
      return contacts().filter((c) => ids.includes(c.contactId));
    },
    async contact(workspaceId, contactId) {
      seed(workspaceId);
      return contacts().find((c) => c.contactId === contactId) ?? null;
    },
    async setTag(workspaceId, contactId, tag, on) {
      seed(workspaceId);
      const set = mem.tags.get(contactId) ?? new Set(contacts().find((c) => c.contactId === contactId)?.tags ?? []);
      if (on) set.add(tag);
      else set.delete(tag);
      mem.tags.set(contactId, set);
    },
  };
}

function newMemory(): MemoryBroadcasts {
  return { broadcasts: [], runs: [], messages: [], tags: new Map(), seq: 0, seeded: new Set() };
}

function copyMessage<T extends BroadcastMessageView>(m: T): T {
  return { ...m, bubbles: [...m.bubbles], followupBubbles: [...m.followupBubbles], sentLinks: [...(m.sentLinks ?? [])] };
}

function blank(): Omit<StoredBroadcast, "id" | "workspaceId" | "key" | "name" | "createdAt"> {
  return {
    audienceTag: "",
    audienceTagId: null,
    contactIds: [],
    status: "draft",
    startMode: "window",
    sendDate: null,
    bubbles: [],
    personaliseMode: "per_person",
    variations: [],
    duplicatedFromId: null,
    followupTemplate: null,
    followupDelayMin: 5,
    windowStart: "10:00",
    windowEnd: "15:00",
    timezone: LUX,
    setterId: null,
  };
}

function blankMessage(): BroadcastMessageView {
  return {
    id: "",
    contactId: "",
    bubbles: [],
    followupBubbles: [],
    status: "drafted",
    edited: false,
    scheduledAt: null,
    sentAt: null,
    error: null,
    reasoning: null,
    leftOutReason: null,
    includedAnyway: false,
    skipReason: null,
    sentLinks: [],
  };
}

// ---------------------------------------------------------------- the OS_MOCK sample

const TAG_ID = "tag-follow-up-friday";
// The vault is the Resources sample's own row (lib/os/mock-resources.ts), so
// Resources › Used by shows the sample broadcasts that link it.
export const MOCK_VAULT = { id: "mock-res-script-vault", name: "DM Script Vault", link: "https://kevinfernandes.me/script-vault" } as const;
const CASE_STUDY = "https://kevinfernandes.me/case-study";

/** Who is on the Friday list in the sample (nora is paused, alex is Personal). */
const SEED_TAGGED = ["c1", "c2", "c3", "c4", "c5", "c6", "c8", "c9", "c10", "c11", "c12"];

/** Hours before the in-review window opens that they (and we) last wrote. */
const SEED_LAST: Record<string, { their: number; ours: number }> = {
  c1: { their: 1, ours: 1.2 },
  c2: { their: 2, ours: 1.5 },
  c3: { their: 4, ours: 3 },
  c8: { their: 16, ours: 15 },
  c11: { their: 20, ours: 21 },
  c12: { their: 21, ours: 20.5 },
  c6: { their: 30, ours: 29 },
  c5: { their: 50, ours: 49 },
  c10: { their: 200, ours: 190 },
  c4: { their: 3, ours: 2 },
  c9: { their: 5, ours: 4 },
};

const NOTES: Record<string, string> = {
  c1: "Gets 40-60 DMs a week, most are 'how much' or 'link?'",
  c2: "Agency owner, wants to hand inbound DMs to a setter",
  c8: "About 40k a month right now, asked what the call covers",
};

const FRIDAY_BUBBLES = (url: string | null, resource = true): BroadcastBubble[] => [
  { type: "text", text: "Hey {first_name}, happy Friday." },
  { type: "text", text: "Made something I think you'll get a lot out of: the scripts I use to answer DMs in one go." },
  { type: "link", url, resourceId: url && resource ? MOCK_VAULT.id : null, label: url && resource ? MOCK_VAULT.name : null },
];

/** The in-review sample's window: the next Friday (today counts until 15:00). */
function reviewDate(now = new Date()): string {
  return nextRunDate(5, "15:00", LUX, now).date;
}

function anchor(): number {
  return windowBounds(reviewDate(), "10:00", "15:00", LUX).start.getTime();
}

function sampleContacts(mem: MemoryBroadcasts): BroadcastContact[] {
  const at = anchor();
  return mockThreads().flatMap((t) => {
    const c = t.contact;
    if (!c) return [];
    const last = SEED_LAST[c.id];
    const iso = (h: number | undefined) => (h === undefined ? null : new Date(at - h * HOUR).toISOString());
    if (!mem.tags.has(c.id)) {
      const tags = new Set(mockContactExtras(c.id).tags);
      if (SEED_TAGGED.includes(c.id) || c.onFriday) tags.add(FOLLOW_UP_FRIDAY.tag);
      mem.tags.set(c.id, tags);
    }
    const crm = mockCrmState(c.id);
    return [
      {
        contactId: c.id,
        username: t.username,
        fullName: t.fullName ?? null,
        kind: c.kind,
        paused: c.paused,
        tags: [...(mem.tags.get(c.id) ?? [])],
        igUserId: t.igUserId,
        conversationId: t.conversationId,
        theirLastAt: last ? iso(last.their) : t.updatedTime,
        ourLastAt: last ? iso(last.ours) : null,
        setterStage: c.setterStage,
        stage: c.stage,
        notes: NOTES[c.id] ?? mockContactExtras(c.id).notes,
        fields: [],
        archived: Boolean(crm.archivedAt),
        spam: crm.spamOverride ?? crm.spam,
        lastInboundAt: null,
      },
    ];
  });
}

function seedSample(mem: MemoryBroadcasts, workspaceId: string, next: (p: string) => string) {
  const now = Date.now();
  const at = (ms: number) => new Date(ms).toISOString();
  const base = { ...blank(), workspaceId, audienceTag: FOLLOW_UP_FRIDAY.tag, audienceTagId: TAG_ID, followupTemplate: "no pressure to read, curious what you think" };
  const contacts = sampleContacts(mem);
  const who = (id: string) => contacts.find((c) => c.contactId === id)!;
  const add = (b: Omit<StoredBroadcast, "id" | "workspaceId" | keyof ReturnType<typeof blank>> & Partial<StoredBroadcast>) => {
    const row = { ...base, ...b, id: next("bc") } as StoredBroadcast;
    mem.broadcasts.push(row);
    return row;
  };

  // 1. The kept weekly row: a draft to duplicate from, with its earlier sends.
  const weekly = add({ key: FOLLOW_UP_FRIDAY.key, name: FOLLOW_UP_FRIDAY.name, bubbles: FRIDAY_BUBBLES(null), createdAt: at(now - 60 * DAY) });

  // 2. Last week's, sent (two approved didn't go).
  const lastDate = localDate(new Date(zonedInstant(reviewDate(), "12:00", LUX).getTime() - 7 * DAY), LUX);
  const sent = add({
    key: `${FOLLOW_UP_FRIDAY.key}-${lastDate}`,
    name: `${FOLLOW_UP_FRIDAY.name} · ${shortDay(lastDate)}`,
    status: "sent",
    sendDate: lastDate,
    bubbles: [{ type: "text", text: "Hey {first_name}, thought of you with this one." }, { type: "link", url: CASE_STUDY, resourceId: null, label: null }],
    duplicatedFromId: weekly.id,
    createdAt: at(now - 9 * DAY),
  });
  const sentRun: BroadcastRunView = { id: next("run"), broadcastId: sent.id, runDate: lastDate, link: null, status: "done", createdAt: at(now - 8 * DAY) };
  mem.runs.push(sentRun);
  const start = windowBounds(lastDate, "10:00", "15:00", LUX).start.getTime();
  const sentPeople: [string, "sent" | "skipped" | "failed", string | null][] = [
    ["c6", "sent", null],
    ["c8", "sent", null],
    ["c11", "sent", null],
    ["c12", "sent", null],
    ["c2", "skipped", "wrote_since_drafting"],
    ["c3", "skipped", "cap"],
  ];
  sentPeople.forEach(([id, status, reason], i) => {
    mem.messages.push({
      ...blankMessage(),
      id: next("bm"),
      runId: sentRun.id,
      workspaceId,
      contactId: id,
      bubbles: asWritten(sent.bubbles, who(id)),
      status,
      scheduledAt: at(start + (i + 1) * 31 * 60_000 + 17_000),
      sentAt: status === "sent" ? at(start + (i + 1) * 31 * 60_000 + 17_000) : null,
      skipReason: reason as BroadcastMessageView["skipReason"],
      error: reason === "cap" ? "Over the daily send cap" : null,
    });
  });

  // 3. This week's, in review: drafts, one approved, one that already had the link, one J couldn't write.
  const date = reviewDate();
  const review = add({
    key: `${FOLLOW_UP_FRIDAY.key}-${date}`,
    name: `${FOLLOW_UP_FRIDAY.name} · ${shortDay(date)}`,
    status: "in_review",
    sendDate: date,
    bubbles: FRIDAY_BUBBLES(MOCK_VAULT.link),
    duplicatedFromId: sent.id,
    createdAt: at(now - 2 * HOUR),
  });
  const run: BroadcastRunView = { id: next("run"), broadcastId: review.id, runDate: date, link: null, status: "review", createdAt: at(now - HOUR) };
  mem.runs.push(run);
  const drafts: [string, string, Partial<BroadcastMessageView>][] = [
    ["c1", "Hey Maya, happy Friday. You said sizing DMs eat your mornings, so this one's for you", { status: "approved", reasoning: "Live · Qualify, used her DM volume" }],
    ["c2", "Hey Tom, happy Friday. Since you're setting up DMs for your agency clients, these scripts should save you some writing", { reasoning: "Live · Opener" }],
    ["c3", "Hey Jordan, happy Friday. Before the call, here's how I'd handle your DMs", { reasoning: "Live · Bridge" }],
    ["c8", "Hey Sam, happy Friday. Made something I think you'll get a lot out of: the scripts I use to answer DMs in one go", { reasoning: "Quiet 16h · Qualify" }],
    ["c11", "Hey Chris, happy Friday. Thought of you with this one, the scripts I use for DMs", { leftOutReason: "already_had_link", reasoning: "Quiet 20h · Booked" }],
    ["c12", "", { status: "draft_failed", error: "Couldn't draft: J timed out" }],
  ];
  for (const [id, text, extra] of drafts) {
    mem.messages.push({
      ...blankMessage(),
      id: next("bm"),
      runId: run.id,
      workspaceId,
      contactId: id,
      bubbles: text ? [text, "Made something I think you'll get a lot out of: the scripts I use to answer DMs in one go.", MOCK_VAULT.link].slice(text.includes("scripts I use") ? 1 : 0) : [],
      followupBubbles: text ? ["no pressure to read, curious what you think"] : [],
      ...extra,
    });
  }
  // Chris had the vault in an earlier send (the link guard).
  const chris = mem.messages.find((m) => m.runId === sentRun.id && m.contactId === "c11");
  if (chris) chris.sentLinks = [MOCK_VAULT.link];

  // 4. A new one, not started: Now, 5 variations.
  add({
    key: "webinar-replay",
    name: "Webinar replay",
    audienceTag: "hot",
    audienceTagId: "tag-hot",
    startMode: "now",
    windowEnd: "18:00",
    personaliseMode: "variations",
    followupTemplate: null,
    bubbles: [{ type: "text", text: "hey {first_name}, the replay is up" }, { type: "link", url: null, resourceId: null, label: null }],
    createdAt: at(now - 30 * 60_000),
  });
}

function shortDay(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: LUX }).format(zonedInstant(date, "12:00", LUX));
}

type Mocked = BroadcastStore & { mem: MemoryBroadcasts };
const g = globalThis as { __osMockBroadcasts2?: Mocked };

export function mockBroadcastStore(): Mocked {
  return (g.__osMockBroadcasts2 ??= createMemoryBroadcastStore({
    contacts: sampleContacts,
    tagName: (id) => id.replace(/^tag-/, ""),
    seed: seedSample,
  }));
}

/** Sample resources for the picker (OS_MOCK=1). */
export function mockResources(): { id: string; name: string; link: string | null }[] {
  return MOCK_LEAD_MAGNETS.map((r) => ({ ...r }));
}
