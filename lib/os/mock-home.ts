// OS_MOCK=1 sample for Home's funnel, its inbox tile and the All · funnel
// board (dm-crm 031/032): about 640 synthetic people over the last 90 days
// with realistic step-to-step rates (roughly 214 in the last 30 days, 6 won),
// a few older wins closed in the period, some with no amount yet, and the
// Won/Lost moves and amounts made on the board. In memory on globalThis like
// the rest of the mock; gone on restart.

import type { FunnelContact } from "@/lib/os/crm-funnel";
import { funnelColumns } from "@/lib/os/funnel";
import type { InboxCountContact } from "@/lib/os/home-funnel";
import { mockThreads } from "@/lib/os/mock";
import { mockCrmState } from "@/lib/os/mock-crm";

const DAY = 86_400_000;
const HOUR = 3_600_000;

interface Synthetic {
  contact: FunnelContact;
  name: string;
  setter: string;
  lastAt: Date;
  /** The won event's time (also for wins with no amount). */
  wonEventAt: Date | null;
}

interface MockMove {
  stage: "WON" | "LOST";
  wonAmount: number | null;
  wonAt: Date | null;
  offer: string;
}

interface MockHome {
  anchor: number;
  people: Synthetic[];
  moves: Map<string, MockMove>;
}

const mem = ((globalThis as { __osMockHome?: MockHome }).__osMockHome ??= { anchor: 0, people: [], moves: new Map() });

/** Seeded so the sample is the same on every load. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["ben", "zoe", "rico", "noah", "priya", "lena", "max", "ivy", "nate", "kai", "mila", "omar", "ella", "finn", "sara", "leo", "nina", "theo", "ruby", "jay", "ana", "luca", "maya", "eli", "rosa", "dan", "iris", "sam", "tara", "otto"];
const LAST = ["makes", "paints", "studio", "builds", "edits", "fit", "cto", "brand", "design", "ops", "coach", "creates", "films", "writes", "yoga", "codes", "shoots", "sells", "media", "labs"];
const AMOUNTS = [1200, 1800, 2400, 2400, 3600];

/** The step a person stops at, by the rates from the canvas (61%, 56%, 55%, 44%, 78%, 43%). */
const RATES = [0.61, 0.565, 0.55, 0.44, 0.78, 0.43];

const STAGE_AT = ["NEW", "IN_CONVERSATION", "QUALIFIED", "CALL_OFFERED", "CALL_BOOKED", "SHOWED", "WON"] as const;
const HINT_AT = ["open", "value", "qualify", "assure", "booked", "booked", "booked"];
const EVENTS_AT = [[], ["conversation_started"], ["conversation_started"], ["conversation_started", "offer_made"], ["conversation_started", "offer_made", "call_booked"], ["conversation_started", "offer_made", "call_booked", "showed"], ["conversation_started", "offer_made", "call_booked", "showed", "won"]];

function person(i: number, rand: () => number, now: number, createdAgo: number): Synthetic {
  let step = 0;
  while (step < 6 && rand() < RATES[step]) step++;
  const createdAt = new Date(now - createdAgo);
  const lost = step >= 1 && step <= 5 && step !== 4 && rand() < (step === 5 ? 0.5 : 0.25);
  const kindRoll = rand();
  const won = step === 6;
  const noAmount = won && rand() < 0.2;
  const wonEventAt = won ? new Date(Math.min(now - HOUR, createdAt.getTime() + (3 + rand() * 20) * DAY)) : null;
  const archived = !won && rand() < 0.05;
  const handle = `${FIRST[i % FIRST.length]}.${LAST[(i * 7 + Math.floor(i / FIRST.length)) % LAST.length]}${i >= FIRST.length * LAST.length ? i : ""}`;
  return {
    name: handle,
    setter: step >= 5 ? "Post-call" : "J",
    lastAt: new Date(Math.max(createdAt.getTime(), now - rand() * Math.min(createdAgo, 9 * DAY))),
    wonEventAt,
    contact: {
      id: `mh${i}`,
      createdAt,
      kind: kindRoll < 0.78 ? "SALES" : kindRoll < 0.97 ? "UNSORTED" : "PITCHES",
      kindSource: i % 97 === 5 ? "import" : "entry",
      entryPath: i % 3 ? "keyword_dm" : "comment",
      spam: i % 61 === 7,
      spamOverride: null,
      archivedAt: archived ? new Date(now - rand() * 5 * DAY) : null,
      stage: lost ? "LOST" : STAGE_AT[step],
      setterStage: HINT_AT[step],
      attendance: step === 4 && rand() < 0.3 ? "NO_SHOW" : step >= 5 ? "SHOWED" : null,
      columns: funnelColumns(null),
      events: new Set(EVENTS_AT[step]),
      loggedColumns: new Set(step >= 2 && rand() < 0.6 ? ["qualify"] : []),
      wonAmount: won && !noAmount ? AMOUNTS[Math.floor(rand() * AMOUNTS.length)] : null,
      wonAt: won && !noAmount ? wonEventAt : null,
    },
  };
}

function people(now: Date): Synthetic[] {
  // One sample per process; re-anchor once a day so "the last 7 days" stays full.
  if (mem.people.length && now.getTime() - mem.anchor < DAY) return mem.people;
  const rand = rng(31);
  const t = now.getTime();
  const out: Synthetic[] = [];
  for (let i = 0; i < 640; i++) out.push(person(i, rand, t, (i / 640) * 90 * DAY + rand() * 3 * HOUR));
  // Older people won in the last few weeks: "Closed in period" > "From this cohort".
  for (let i = 0; i < 4; i++) {
    const p = person(700 + i, rand, t, (100 + i * 12) * DAY);
    const at = new Date(t - (4 + i * 6) * DAY);
    Object.assign(p.contact, { stage: "WON", wonAmount: AMOUNTS[i % AMOUNTS.length], wonAt: at, events: new Set(EVENTS_AT[6]), attendance: "SHOWED" });
    Object.assign(p, { wonEventAt: at, setter: "Post-call" });
    out.push(p);
  }
  mem.anchor = t;
  mem.people = out;
  return out;
}

export function mockHomeContacts(now: Date): FunnelContact[] {
  return people(now).map((p) => p.contact);
}

export function mockHomeInfo(): Map<string, { name: string; setter: string; lastAt: Date | null }> {
  return new Map(mem.people.map((p) => [p.contact.id, { name: p.name, setter: p.setter, lastAt: p.lastAt }]));
}

export function mockWonAt(contactId: string, now: Date): Date {
  return mem.moves.get(contactId)?.wonAt ?? mem.people.find((p) => p.contact.id === contactId)?.wonEventAt ?? new Date(now.getTime() - 3 * DAY);
}

export function isMockHomeContact(contactId: string): boolean {
  return /^mh\d+$/.test(contactId);
}

/** The board's Won/Lost moves and filled-in amounts. */
export function recordMockFunnelMove(contactId: string, move: MockMove) {
  mem.moves.set(contactId, move);
}

export function recordMockWonAmount(contactId: string, offer: string, amount: number, wonAt: Date) {
  mem.moves.set(contactId, { stage: "WON", wonAmount: amount, wonAt, offer });
}

/** Apply the moves on top of the samples (sample threads' stages come from the stage writer's mock). */
export function applyMockFunnelMoves(contacts: FunnelContact[]): FunnelContact[] {
  return contacts.map((c) => {
    const m = mem.moves.get(c.id);
    if (!m) return c;
    const stage = isMockHomeContact(c.id) ? m.stage : c.stage;
    const onWon = stage === "WON";
    return { ...c, stage, wonAmount: onWon ? m.wonAmount : null, wonAt: onWon ? m.wonAt : null, events: onWon ? new Set([...c.events, "won"]) : c.events };
  });
}

/** The inbox tile's sample: the sample threads' CRM fields plus a few quiet leads. */
export function mockInboxContacts(now: Date): InboxCountContact[] {
  const iso = (v: string | null) => (v ? new Date(v) : null);
  const threads = mockThreads().flatMap((t) => {
    if (!t.contact) return [];
    const s = mockCrmState(t.contact.id);
    return [{ id: t.contact.id, kind: t.contact.kind, lastInboundAt: iso(s.lastInboundAt), lastOutboundAt: iso(s.lastOutboundAt), lastOpenedAt: iso(s.lastOpenedAt), spam: s.spam, spamOverride: s.spamOverride, archivedAt: iso(s.archivedAt) }];
  });
  const ago = (h: number) => new Date(now.getTime() - h * HOUR);
  const extra: InboxCountContact[] = [
    { id: "mi1", kind: "SALES", lastInboundAt: ago(21), lastOutboundAt: ago(23), lastOpenedAt: ago(20), spam: false, spamOverride: null, archivedAt: null },
    { id: "mi2", kind: "SALES", lastInboundAt: ago(22.5), lastOutboundAt: ago(30), lastOpenedAt: null, spam: false, spamOverride: null, archivedAt: null },
    { id: "mi3", kind: "UNSORTED", lastInboundAt: ago(0.4), lastOutboundAt: ago(2), lastOpenedAt: null, spam: false, spamOverride: null, archivedAt: null },
    { id: "mi4", kind: "SALES", lastInboundAt: ago(1.5), lastOutboundAt: ago(3), lastOpenedAt: null, spam: false, spamOverride: null, archivedAt: null },
  ];
  return [...threads, ...extra];
}
