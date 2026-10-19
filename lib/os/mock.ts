// Sample data for running the DM OS locally without Instagram: start the dev
// server with OS_MOCK=1. Never on in production.
import type { InboxMessage, InboxThread, InboxVoice } from "@/lib/os/inbox";

export function osMockEnabled() {
  return process.env.OS_MOCK === "1" && process.env.NODE_ENV !== "production";
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

const untriaged = { suggestedKind: null, suggestedReason: null, suggestedConfidence: null, suggestedBy: null, triagedMessageId: null, onFriday: false };
const friday = { onFriday: true };

type MockPerson = Omit<InboxThread, "updatedTime"> & { hours: number; firstReply?: string };

const seedPeople: MockPerson[] = [
  { conversationId: "m1", igUserId: "101", username: "maya.builds", preview: "honestly figuring out what to post", hours: 0.4,
    contact: { id: "c1", kind: "SALES", kindSource: "entry", stage: "IN_CONVERSATION", entryPath: "comment", setterStage: "qualify", paused: false, ...untriaged, ...friday } },
  { conversationId: "m2", igUserId: "102", username: "tom.k", preview: "no way this is real 😂", hours: 1,
    contact: { id: "c2", kind: "SALES", kindSource: "entry", stage: "LEAD_MAGNET_SENT", entryPath: "story_reply", setterStage: "opener", paused: false, ...untriaged } },
  { conversationId: "m3", igUserId: "103", username: "jordan.ops", preview: "100%. what would that look like", hours: 2,
    contact: { id: "c3", kind: "SALES", kindSource: "entry", stage: "CALL_OFFERED", entryPath: "comment", setterStage: "bridge", paused: false, ...untriaged } },
  { conversationId: "m4", igUserId: "104", username: "alex.friend", preview: "yes! 7pm", hours: 5,
    contact: { id: "c4", kind: "PERSONAL", kindSource: "user", stage: "NEW", entryPath: null, setterStage: null, paused: false, ...untriaged } },
  { conversationId: "m5", igUserId: "105", username: "priya.studio", preview: "nice, how's it going so far?", hours: 26,
    contact: { id: "c5", kind: "UNSORTED", kindSource: null, stage: "NEW", entryPath: null, setterStage: null, paused: false, ...untriaged } },
  { conversationId: "m6", igUserId: "106", username: "lena.fit", preview: "booked for thursday!", hours: 30,
    contact: { id: "c6", kind: "SALES", kindSource: "entry", stage: "CALL_BOOKED", entryPath: "keyword_dm", setterStage: "booked", paused: false, ...untriaged, ...friday } },
  { conversationId: "m7", igUserId: "107", username: "growthguru_99", preview: "Hey! Want to grow your page 10x?", hours: 80,
    contact: { id: "c7", kind: "UNSORTED", kindSource: null, stage: "NEW", entryPath: null, setterStage: null, paused: false, ...untriaged } },
  { conversationId: "m8", igUserId: "108", username: "sam.creates", fullName: "Sam Ortega", preview: "about 40k a month right now", hours: 50,
    contact: { id: "c8", kind: "SALES", kindSource: "entry", stage: "QUALIFIED", entryPath: "keyword_dm", setterStage: "qualify", paused: false, ...untriaged, ...friday } },
  { conversationId: "m9", igUserId: "109", username: "nora.coaching", fullName: "Nora Lind", preview: "just paid, so excited", hours: 120,
    contact: { id: "c9", kind: "SALES", kindSource: "entry", stage: "WON", entryPath: "comment", setterStage: "booked", paused: true, ...untriaged } },
  { conversationId: "m10", igUserId: "110", username: "dev.hobby", preview: "just curious tbh, not running anything", hours: 200,
    contact: { id: "c10", kind: "SALES", kindSource: "entry", stage: "NOT_QUALIFIED", entryPath: "story_reply", setterStage: "qualify", paused: false, ...untriaged, ...friday } },
  // Follow-up samples (lib/os/sequences/mock-seed.ts): a no-show, and one who showed.
  { conversationId: "m11", igUserId: "111", username: "chris.makes", fullName: "Chris Doyle", preview: "perfect, see you then", hours: 27,
    contact: { id: "c11", kind: "SALES", kindSource: "entry", stage: "CALL_BOOKED", entryPath: "comment", setterStage: "booked", paused: false, ...untriaged } },
  { conversationId: "m12", igUserId: "112", username: "ava.creates", fullName: "Ava Moreau", preview: "locked in for tomorrow 🙌", hours: 40,
    contact: { id: "c12", kind: "SALES", kindSource: "entry", stage: "CALL_BOOKED", entryPath: "keyword_dm", setterStage: "booked", paused: false, ...untriaged } },
];

// On globalThis so kind/stage/triage changes made by server actions are seen
// by the page (they can load this module as separate instances in dev).
const people = ((globalThis as { __osMockPeople?: MockPerson[] }).__osMockPeople ??= seedPeople);

export function mockThreads(): InboxThread[] {
  return people.map((p) => {
    const { hours, ...t } = p;
    delete t.firstReply;
    return { ...t, updatedTime: hoursAgo(hours) };
  });
}

// Messages sent while running on sample data (composer and approved J
// drafts). On globalThis so server actions and pages share them across
// module reloads; gone on restart.
const sent = ((globalThis as { __osMockSent?: Map<string, InboxMessage[]> }).__osMockSent ??= new Map());

export function appendMockMessage(conversationId: string, text: string, at: Date = new Date()) {
  const list = sent.get(conversationId) ?? [];
  list.push({ id: `${conversationId}-sent-${list.length + 1}`, text, fromMe: true, createdTime: at.toISOString() });
  sent.set(conversationId, list);
  const person = people.find((p) => p.conversationId === conversationId);
  if (person) {
    person.firstReply ??= person.preview ?? "";
    person.preview = text;
  }
}

/** A voice note sent on sample data; returns its message id. */
export function appendMockVoice(conversationId: string, voice: InboxVoice): string {
  const list = sent.get(conversationId) ?? [];
  const id = `${conversationId}-voice-${list.length + 1}`;
  list.push({ id, text: "", fromMe: true, createdTime: new Date().toISOString(), voice });
  sent.set(conversationId, list);
  const person = people.find((p) => p.conversationId === conversationId);
  if (person) {
    person.firstReply ??= person.preview ?? "";
    person.preview = "Sent a voice note";
  }
  return id;
}

/** Sample data only: a message "from them", so the booking flow (pick a
 *  time, give an email, send the screenshot) can be clicked through. */
export function appendMockIncoming(conversationId: string, text: string, attachment: string | null = null) {
  const list = sent.get(conversationId) ?? [];
  list.push({ id: `${conversationId}-in-${list.length + 1}`, text, fromMe: false, createdTime: new Date().toISOString(), attachment });
  sent.set(conversationId, list);
  const person = people.find((p) => p.conversationId === conversationId);
  if (person) {
    person.firstReply ??= person.preview ?? "";
    person.preview = attachment ? "Sent a photo" : text;
  }
}

export function mockMessages(conversationId: string): InboxMessage[] {
  const t = people.find((p) => p.conversationId === conversationId);
  if (!t) return [];
  return [
    { id: `${conversationId}-1`, text: "hey! saw your reel about the AI setter", fromMe: false, createdTime: hoursAgo(t.hours + 3) },
    { id: `${conversationId}-2`, text: "appreciate you reaching out 🙌 what caught your eye?", fromMe: true, createdTime: hoursAgo(t.hours + 2.5) },
    { id: `${conversationId}-3`, text: t.firstReply ?? t.preview ?? "", fromMe: false, createdTime: hoursAgo(t.hours) },
    ...(sent.get(conversationId) ?? []),
  ];
}

/** The sample contact behind a contact id, for J's mock store. */
export function mockContact(contactId: string) {
  const p = people.find((x) => x.contact?.id === contactId);
  if (!p?.contact) return null;
  return { conversationId: p.conversationId, igUserId: p.igUserId, username: p.username, fullName: p.fullName ?? null, contact: p.contact };
}

/** Kind, stage and triage changes made while running on sample data. Kept in memory
 *  so the controls work in a local demo; gone on restart. */
export function updateMockContact(contactId: string, data: Partial<NonNullable<InboxThread["contact"]>> & { triagedAt?: Date }) {
  const person = people.find((p) => p.contact?.id === contactId);
  if (!person?.contact) return;
  const { triagedAt: _seen, ...rest } = data;
  void _seen;
  Object.assign(person.contact, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)));
}

/** CRM fields the Contacts screen edits on sample data (tags, notes, email).
 *  In memory like the rest; gone on restart. */
export interface MockContactExtras {
  tags: string[];
  notes: string | null;
  email: string | null;
}

const seedExtras: Record<string, MockContactExtras> = {
  c1: { tags: ["hot"], notes: "Posts daily, stuck on what converts.", email: null },
  c3: { tags: ["hot", "agency"], notes: null, email: "jordan@opsco.io" },
  c6: { tags: ["booked"], notes: "Call Thursday 3pm.", email: "lena@fitlab.co" },
  c8: { tags: ["agency"], notes: null, email: null },
  c9: { tags: ["client"], notes: "Started the program.", email: "nora@lind.coach" },
  c11: { tags: [], notes: null, email: "chris@doyle.studio" },
  c12: { tags: [], notes: "Wants 10k/mo from IG without posting every day. DMs pile up, no system for them.", email: "ava@moreau.co" },
};

const extras = ((globalThis as { __osMockExtras?: Record<string, MockContactExtras> }).__osMockExtras ??= structuredClone(seedExtras));

export function mockContactExtras(contactId: string): MockContactExtras {
  return (extras[contactId] ??= { tags: [], notes: null, email: null });
}

export function updateMockContactExtras(contactId: string, data: Partial<MockContactExtras>) {
  Object.assign(mockContactExtras(contactId), Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)));
}
