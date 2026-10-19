// S5 sample data (OS_MOCK=1): the Follow-up Friday broadcast, its runs and
// messages, and who carries the follow-up-friday tag, in memory on
// globalThis (server actions and pages share it; gone on restart).
//
// The sample's "last message" times are set relative to the next run's window
// start, so the builder shows people inside and outside the 24h window
// whatever day the demo runs.

import type { BroadcastPatch, BroadcastStore, MessagePatch } from "@/lib/os/broadcasts/store";
import { nextRunDate, windowBounds } from "@/lib/os/broadcasts/schedule";
import { FOLLOW_UP_FRIDAY, type BroadcastContact, type BroadcastMessageView, type BroadcastRunView, type BroadcastView } from "@/lib/os/broadcasts/types";
import { mockContactExtras, mockThreads } from "@/lib/os/mock";

const HOUR = 3_600_000;

interface MockBroadcasts {
  broadcasts: (BroadcastView & { workspaceId: string })[];
  runs: BroadcastRunView[];
  messages: (BroadcastMessageView & { runId: string; workspaceId: string })[];
  tags: Map<string, Set<string>>;
  seq: number;
}

const SEED_BROADCAST: Omit<BroadcastView, "id"> = {
  key: FOLLOW_UP_FRIDAY.key,
  name: FOLLOW_UP_FRIDAY.name,
  audienceTag: FOLLOW_UP_FRIDAY.tag,
  link: null,
  template: "hey {first_name}, thought of you with this one\n{link}",
  followupTemplate: "no pressure to watch, curious what you think",
  followupDelayMin: 5,
  windowDay: 5,
  windowStart: "10:00",
  windowEnd: "15:00",
  timezone: "Europe/Luxembourg",
  setterId: null,
  enabled: true,
};

/** Who is on the Friday list in the sample (nora is paused, alex is Personal). */
const SEED_TAGGED = ["c1", "c2", "c3", "c4", "c5", "c6", "c8", "c9", "c10", "c11", "c12"];

/** Hours before the window opens that they (and we) last wrote. */
const SEED_LAST: Record<string, { their: number; ours: number }> = {
  c1: { their: 1, ours: 1.2 }, // maya: live, mid-qualify
  c2: { their: 2, ours: 1.5 }, // tom: live
  c3: { their: 4, ours: 3 }, // jordan: live-ish
  c8: { their: 16, ours: 15 }, // sam: quiet
  c11: { their: 20, ours: 21 }, // chris: quiet
  c12: { their: 21, ours: 20.5 }, // ava: quiet
  c6: { their: 30, ours: 29 }, // lena: outside the window
  c5: { their: 50, ours: 49 }, // priya: outside
  c10: { their: 200, ours: 190 }, // dev: outside
  c4: { their: 3, ours: 2 },
  c9: { their: 5, ours: 4 },
};

const NOTES: Record<string, string> = {
  c1: "Gets 40-60 DMs a week, most are 'how much' or 'link?'",
  c2: "Agency owner, wants to hand inbound DMs to a setter",
  c8: "Missed last week's call, about 40k a month right now",
};

const mem: MockBroadcasts = ((globalThis as { __osMockBroadcasts?: MockBroadcasts }).__osMockBroadcasts ??= {
  broadcasts: [],
  runs: [],
  messages: [],
  tags: new Map(),
  seq: 0,
});

function id(prefix: string) {
  mem.seq += 1;
  return `${prefix}${mem.seq}`;
}

function seed(workspaceId: string) {
  if (!mem.broadcasts.some((b) => b.workspaceId === workspaceId)) {
    mem.broadcasts.push({ ...SEED_BROADCAST, id: id("bc"), workspaceId });
  }
  if (!mem.tags.size) {
    for (const t of mockThreads()) {
      const cid = t.contact?.id;
      if (!cid) continue;
      const tags = new Set(mockContactExtras(cid).tags);
      if (SEED_TAGGED.includes(cid) || t.contact?.onFriday) tags.add(FOLLOW_UP_FRIDAY.tag);
      mem.tags.set(cid, tags);
    }
  }
}

/** The next window start for the sample times. */
function anchor(): number {
  const b = mem.broadcasts[0] ?? { ...SEED_BROADCAST };
  const { date } = nextRunDate(b.windowDay, b.windowEnd, b.timezone, new Date());
  return windowBounds(date, b.windowStart, b.windowEnd, b.timezone).start.getTime();
}

function mockContacts(): BroadcastContact[] {
  const at = anchor();
  return mockThreads().flatMap((t) => {
    const c = t.contact;
    if (!c) return [];
    const last = SEED_LAST[c.id];
    const iso = (h: number | undefined) => (h === undefined ? null : new Date(at - h * HOUR).toISOString());
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
      },
    ];
  });
}

function viewOf(b: BroadcastView & { workspaceId: string }): BroadcastView {
  const view: BroadcastView & { workspaceId?: string } = { ...b };
  delete view.workspaceId;
  return view;
}

function patchMessage(m: BroadcastMessageView, p: MessagePatch) {
  Object.assign(
    m,
    Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined))
  );
}

const store: BroadcastStore = {
  async list(workspaceId) {
    seed(workspaceId);
    return mem.broadcasts.filter((b) => b.workspaceId === workspaceId).map(viewOf);
  },
  async get(workspaceId, key) {
    seed(workspaceId);
    const b = mem.broadcasts.find((x) => x.workspaceId === workspaceId && x.key === key);
    return b ? viewOf(b) : null;
  },
  async getById(bid) {
    return mem.broadcasts.find((x) => x.id === bid) ?? null;
  },
  async update(workspaceId, bid, patch: BroadcastPatch) {
    const b = mem.broadcasts.find((x) => x.id === bid && x.workspaceId === workspaceId);
    if (!b) throw new Error("Broadcast not found.");
    Object.assign(b, patch);
    return viewOf(b);
  },
  async getRun(broadcastId, runDate) {
    return mem.runs.find((r) => r.broadcastId === broadcastId && r.runDate === runDate) ?? null;
  },
  async getRunById(runId) {
    return mem.runs.find((r) => r.id === runId) ?? null;
  },
  async latestRuns(broadcastId, take) {
    return mem.runs
      .filter((r) => r.broadcastId === broadcastId)
      .sort((a, b) => b.runDate.localeCompare(a.runDate))
      .slice(0, take);
  },
  async createRun(broadcastId, runDate, link) {
    const cur = mem.runs.find((r) => r.broadcastId === broadcastId && r.runDate === runDate);
    if (cur) {
      cur.link = link;
      return cur;
    }
    const run: BroadcastRunView = { id: id("run"), broadcastId, runDate, link, status: "drafting", createdAt: new Date().toISOString() };
    mem.runs.push(run);
    return run;
  },
  async updateRun(runId, patch) {
    const r = mem.runs.find((x) => x.id === runId);
    if (r) Object.assign(r, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
  },
  async messages(runId) {
    return mem.messages
      .filter((m) => m.runId === runId)
      .sort((a, b) => (a.scheduledAt ?? "~").localeCompare(b.scheduledAt ?? "~") || a.id.localeCompare(b.id))
      .map((m) => ({ ...m }));
  },
  async getMessage(mid) {
    const m = mem.messages.find((x) => x.id === mid);
    return m ? { ...m } : null;
  },
  async upsertMessage(runId, workspaceId, contactId, data) {
    let m = mem.messages.find((x) => x.runId === runId && x.contactId === contactId);
    if (!m) {
      m = { id: id("bm"), runId, workspaceId, contactId, bubbles: [], followupBubbles: [], status: "drafted", edited: false, scheduledAt: null, sentAt: null, error: null, reasoning: null };
      mem.messages.push(m);
    }
    patchMessage(m, data);
    return { ...m };
  },
  async updateMessage(mid, patch) {
    const m = mem.messages.find((x) => x.id === mid);
    if (m) patchMessage(m, patch);
  },
  async rows(workspaceId, opts) {
    const out = mem.messages
      .filter((m) => m.workspaceId === workspaceId && (!opts.statuses || opts.statuses.includes(m.status)) && (!opts.contactId || m.contactId === opts.contactId))
      .flatMap((m) => {
        const run = mem.runs.find((r) => r.id === m.runId);
        const b = run ? mem.broadcasts.find((x) => x.id === run.broadcastId) : null;
        return run && b ? [{ ...m, runDate: run.runDate, broadcastKey: b.key, broadcastName: b.name }] : [];
      })
      .sort((a, b) => (a.scheduledAt ?? "~").localeCompare(b.scheduledAt ?? "~"));
    return out.slice(0, opts.take ?? 200);
  },
  async taggedContacts(workspaceId, tag) {
    seed(workspaceId);
    return mockContacts().filter((c) => c.tags.includes(tag));
  },
  async contact(workspaceId, contactId) {
    seed(workspaceId);
    return mockContacts().find((c) => c.contactId === contactId) ?? null;
  },
  async setTag(workspaceId, contactId, tag, on) {
    seed(workspaceId);
    const set = mem.tags.get(contactId) ?? new Set<string>();
    if (on) set.add(tag);
    else set.delete(tag);
    mem.tags.set(contactId, set);
  },
};

export function mockBroadcastStore(): BroadcastStore {
  return store;
}

