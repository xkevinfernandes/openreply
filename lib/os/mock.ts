// Sample data for running the DM OS locally without Instagram: start the dev
// server with OS_MOCK=1. Never on in production.
import type { InboxMessage, InboxThread, InboxVoice } from "@/lib/os/inbox";
import type { ContactPanelData } from "@/lib/os/contact-panel/types";
import { columnFor, funnelColumns } from "@/lib/os/funnel";
import type { MediaView } from "@/lib/os/media";
import { messagePreview, partLabel } from "@/lib/os/messages/parse";
import type { RichMessage } from "@/lib/os/messages/types";

export function osMockEnabled() {
  return process.env.OS_MOCK === "1" && process.env.NODE_ENV !== "production";
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

const untriaged = { suggestedKind: null, suggestedReason: null, suggestedConfidence: null, suggestedBy: null, triagedMessageId: null, onFriday: false, seenAt: null };
const friday = { onFriday: true };

type MockPerson = Omit<InboxThread, "updatedTime"> & { hours: number; firstReply?: string };

const seedPeople: MockPerson[] = [
  { conversationId: "m1", igUserId: "101", username: "maya.builds", fullName: "Maya", preview: "like 40-60 on a good week, most are ‘how much’ or ‘link?’", hours: 0.25,
    contact: { id: "c1", kind: "SALES", kindSource: "entry", stage: "IN_CONVERSATION", entryPath: "story_reply", setterStage: "qualify", paused: false, ...untriaged, ...friday, seenAt: new Date(Date.now() - 50 * 60_000) } },
  { conversationId: "m2", igUserId: "102", username: "tom.k", preview: "SETTER", hours: 1,
    contact: { id: "c2", kind: "SALES", kindSource: "entry", stage: "LEAD_MAGNET_SENT", entryPath: "story_reply", setterStage: "opener", paused: false, ...untriaged } },
  { conversationId: "m3", igUserId: "103", username: "jordan.ops", preview: "tue or wed works for me", hours: 2,
    contact: { id: "c3", kind: "SALES", kindSource: "entry", stage: "CALL_OFFERED", entryPath: "comment", setterStage: "bridge", paused: false, ...untriaged } },
  { conversationId: "m4", igUserId: "104", username: "alex.friend", preview: "yes! 7pm", hours: 5,
    contact: { id: "c4", kind: "PERSONAL", kindSource: "user", stage: "NEW", entryPath: null, setterStage: null, paused: false, ...untriaged } },
  { conversationId: "m5", igUserId: "105", username: "priya.studio", preview: "nice, how's it going so far?", hours: 26,
    contact: { id: "c5", kind: "UNSORTED", kindSource: null, stage: "NEW", entryPath: null, setterStage: null, paused: false, ...untriaged } },
  { conversationId: "m6", igUserId: "106", username: "lena.fit", preview: "booked for thursday!", hours: 30,
    contact: { id: "c6", kind: "SALES", kindSource: "entry", stage: "CALL_BOOKED", entryPath: "keyword_dm", setterStage: "booked", paused: false, ...untriaged, ...friday } },
  { conversationId: "m7", igUserId: "107", username: "growthguru_99", preview: "Hey! Want to grow your page 10x?", hours: 80,
    contact: { id: "c7", kind: "PITCHES", kindSource: "triage", stage: "NEW", entryPath: null, setterStage: null, paused: false, ...untriaged } },
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
  if (conversationId === MAYA.conversationId) return [...mayaThread().map(toInboxMessage), ...(sent.get(conversationId) ?? [])];
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

// ---------------------------------------------------------------- UI redesign
// Maya's thread exactly as on the InboxA board, as rich messages (story
// reply, OpenReply button card, reel share, J's bubbles with a heart, link in
// its own bubble, Seen, an incoming voice note with its transcript). Other
// streams add their own samples in lib/os/mock-<stream>.ts.

export const MAYA = { contactId: "c1", conversationId: "m1", username: "maya.builds" } as const;

/** A time `daysAgo` days back at hh:mm local; "today" times stay in the past. */
function dayAt(daysAgo: number, h: number, m: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}
const minsAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

function msg(over: Partial<RichMessage> & Pick<RichMessage, "id" | "direction" | "at" | "parts">): RichMessage {
  return {
    fromMe: over.direction === "outgoing",
    reactions: [],
    seenAt: null,
    deliveryStatus: over.direction === "outgoing" ? "read" : null,
    origin: null,
    automationId: null,
    fromSetter: false,
    quotedMessageId: null,
    deleted: false,
    edited: false,
    refreshUrl: null,
    ...over,
  };
}

export const MAYA_VOICE_TRANSCRIPT = "honestly it's mostly the same two questions over and over, how much is it and where's the link";

export function mayaThread(): RichMessage[] {
  return [
    msg({ id: "m1-r1", direction: "incoming", at: dayAt(2, 9, 12), parts: [
      { type: "story_reply", storyId: "story-setter", assetId: null, url: null, mention: false },
      { type: "text", text: "SETTER" },
    ] }),
    msg({ id: "m1-r2", direction: "outgoing", at: dayAt(2, 9, 12), origin: "automation", automationId: "auto-setter", parts: [
      { type: "template", image: "/os-mock/setter-starter.png", title: "Claude Code Setter Starter", subtitle: "The exact setup I run my DMs on. Free, about 10 minutes.", buttons: [
        { title: "Get the guide", url: "https://kevinfernandes.me/setter-starter", payload: null, kind: "url" },
        { title: "Watch the walkthrough", url: "https://kevinfernandes.me/setter-walkthrough", payload: null, kind: "url" },
      ] },
    ] }),
    msg({ id: "m1-r3", direction: "incoming", at: dayAt(2, 16, 5), parts: [
      { type: "share", kind: "reel", mediaId: "reel-claude-dms", url: "https://www.instagram.com/reel/mock/", caption: "I let Claude set my DMs for a week" },
    ] }),
    msg({ id: "m1-r4", direction: "incoming", at: dayAt(2, 16, 6), parts: [{ type: "text", text: "saw this one too, is it a real thing or just a demo?" }] }),
    msg({ id: "m1-r5", direction: "outgoing", at: dayAt(2, 16, 9), origin: "api", fromSetter: true, parts: [{ type: "text", text: "real thing haha, I run my own DMs on it" }] }),
    msg({ id: "m1-r6", direction: "outgoing", at: dayAt(2, 16, 9), origin: "api", fromSetter: true, reactions: [{ emoji: "❤", fromMe: false, at: dayAt(1, 16, 19) }], parts: [{ type: "text", text: "want the scripts I use? free" }] }),
    msg({ id: "m1-r7", direction: "incoming", at: dayAt(1, 16, 20), parts: [{ type: "text", text: "yes please" }] }),
    msg({ id: "m1-r8", direction: "outgoing", at: dayAt(1, 16, 24), origin: "api", fromSetter: true, parts: [{ type: "text", text: "here you go" }] }),
    msg({ id: "m1-r9", direction: "outgoing", at: dayAt(1, 16, 24), origin: "api", fromSetter: true, parts: [
      { type: "link", url: "https://kevinfernandes.me/script-vault", domain: "kevinfernandes.me", title: "DM Script Vault: the 12 scripts I actually use" },
    ] }),
    msg({ id: "m1-r10", direction: "incoming", at: minsAgo(60), parts: [{ type: "text", text: "honestly the DMs are eating my whole morning lol" }] }),
    msg({ id: "m1-r11", direction: "outgoing", at: minsAgo(55), origin: "api", fromSetter: true, seenAt: minsAgo(50), parts: [{ type: "text", text: "haha the classic. how many are you getting a day roughly?" }] }),
    msg({ id: "m1-r12", direction: "incoming", at: minsAgo(16), parts: [{ type: "voice", url: null, durationMs: 14_000 }] }),
    msg({ id: "m1-r13", direction: "incoming", at: minsAgo(15), parts: [{ type: "text", text: "like 40-60 on a good week, most are ‘how much’ or ‘link?’" }] }),
  ];
}

/** Which resource a sent link was (the "Script Vault" chip under J's bubble). */
export const MOCK_LEAD_MAGNET_BY_MESSAGE: Record<string, string> = { "m1-r9": "DM Script Vault" };

/** J's pending draft for Maya, as on the board. */
export const MAYA_DRAFT = {
  bubbles: ["ok that's a lot of the same two questions", "what's stopping you from just automating those right now?"],
  setterStage: "qualify",
  reasoning: "She named the pain (repeat questions eat her mornings). Qualify: ask what's in the way before offering anything.",
};

/** Voice in and out with transcripts. Outgoing: a voice note J sent jordan.ops. */
export function mockMediaFor(conversationId: string): Map<string, MediaView> {
  const out = new Map<string, MediaView>();
  const base = { status: "done" as const, description: null, caption: null, story: null };
  if (conversationId === MAYA.conversationId) {
    out.set("m1-r12", { ...base, messageId: "m1-r12", kind: "voice", transcript: MAYA_VOICE_TRANSCRIPT, durationMs: 14_000 });
    out.set("m1-r1", { ...base, messageId: "m1-r1", kind: "story_reply", transcript: null, durationMs: null,
      story: { id: "story-setter", thumbnailUrl: null, caption: "Claude built my setter", topic: "AI setter", postedAt: dayAt(2, 8, 0), permalink: null } });
    out.set("m1-r3", { ...base, messageId: "m1-r3", kind: "share", transcript: null, durationMs: null, caption: "I let Claude set my DMs for a week" });
  }
  if (conversationId === "m3") {
    out.set("m3-voice-out", { ...base, messageId: "m3-voice-out", kind: "voice", transcript: "hey Jordan, quick one, just headed out. tuesday or wednesday both work, I'll send you two times", durationMs: 9_000 });
  }
  return out;
}

/** The text view of a rich message (the current inbox renders text only). */
function toInboxMessage(m: RichMessage): InboxMessage {
  const media = mockMediaFor(MAYA.conversationId).get(m.id);
  const text = m.parts.length === 1 && m.parts[0].type === "voice"
    ? media?.transcript ? `[voice note] ${media.transcript}` : "[voice note]"
    : m.parts.map((p) => (p.type === "text" ? p.text : partLabel(p))).join("\n");
  return { id: m.id, text: text || messagePreview(m), fromMe: m.fromMe, createdTime: m.at };
}

/** Rich messages for any sample thread: Maya's board thread, else the text sample. */
export function mockRichMessages(conversationId: string): RichMessage[] {
  if (conversationId === MAYA.conversationId) return mayaThread();
  return mockMessages(conversationId).map((m) =>
    msg({ id: m.id, direction: m.fromMe ? "outgoing" : "incoming", at: m.createdTime, parts: m.voice ? [{ type: "voice", url: m.voice.url, durationMs: m.voice.durationMs }] : [{ type: "text", text: m.text }] })
  );
}

interface MockPanelExtras {
  fields: ContactPanelData["fields"];
  keywords: ContactPanelData["keywords"];
  nextFollowup: ContactPanelData["nextFollowup"];
}

/** Next Wednesday 10:00 local (Maya's "Follow-up Wed 10:00"). */
function nextWeekday(dow: number, h: number): string {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  d.setDate(d.getDate() + (((dow - d.getDay() + 7) % 7) || 7));
  return d.toISOString();
}

const panelExtras: Record<string, MockPanelExtras> = {
  c1: {
    fields: [
      { key: "first_name", label: "First name", value: "Maya", byJ: true },
      { key: "email", label: "Email", value: null, byJ: false },
      { key: "business", label: "Business", value: "Notion template shop", byJ: true },
      { key: "monthly_revenue", label: "Revenue", value: "~$4k/mo", byJ: true },
      { key: "their_goal", label: "Goal", value: "Automate repeat DMs", byJ: true },
      { key: "their_challenge", label: "Blocker", value: "DMs eat her mornings", byJ: true },
      { key: "timezone", label: "Timezone", value: null, byJ: false },
      { key: "call_time", label: "Call", value: null, byJ: false },
    ],
    keywords: [
      { word: "Story reply", surface: "story_reply", resource: null, at: dayAt(2, 9, 12), title: "Story reply: Claude built my setter" },
      { word: "SETTER", surface: "dm", resource: "Claude Code Setter Starter", at: dayAt(2, 9, 12) },
      { word: "SCRIPT", surface: "dm", resource: "DM Script Vault", at: dayAt(1, 16, 20) },
    ],
    nextFollowup: { label: "Follow-up Wed 10:00", at: nextWeekday(3, 10), href: "/os/follow-ups?tab=scheduled", tip: "Gone quiet 1 sends if no reply" },
  },
};

/** The contact panel on sample data. */
export function mockContactPanel(contactId: string): ContactPanelData | null {
  const p = people.find((x) => x.contact?.id === contactId);
  if (!p?.contact) return null;
  const columns = funnelColumns(null);
  const extra = panelExtras[contactId];
  return {
    contactId,
    conversationId: p.conversationId,
    username: p.username,
    fullName: p.fullName ?? null,
    avatarUrl: null,
    kind: p.contact.kind,
    setter: p.contact.kind === "SALES" ? { id: null, name: "J" } : null,
    stage: { column: columnFor({ stage: p.contact.stage, setterStage: p.contact.setterStage }, columns), columns },
    fields: extra?.fields ?? [
      { key: "first_name", label: "First name", value: p.fullName?.split(" ")[0] ?? null, byJ: false },
      { key: "email", label: "Email", value: mockContactExtras(contactId).email, byJ: false },
    ],
    keywords: extra?.keywords ?? [],
    nextFollowup: extra?.nextFollowup ?? null,
  };
}
