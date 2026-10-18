// Sample data for running the DM OS locally without Instagram: start the dev
// server with OS_MOCK=1. Never on in production.
import type { InboxMessage, InboxThread } from "@/lib/os/inbox";

export function osMockEnabled() {
  return process.env.OS_MOCK === "1" && process.env.NODE_ENV !== "production";
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

const people: Array<Omit<InboxThread, "updatedTime"> & { hours: number }> = [
  { conversationId: "m1", igUserId: "101", username: "maya.builds", preview: "honestly figuring out what to post", hours: 0.4,
    contact: { id: "c1", kind: "SALES", kindSource: "entry", stage: "IN_CONVERSATION", entryPath: "comment", setterStage: "qualify", paused: false } },
  { conversationId: "m2", igUserId: "102", username: "tom.k", preview: "no way this is real 😂", hours: 1,
    contact: { id: "c2", kind: "SALES", kindSource: "entry", stage: "LEAD_MAGNET_SENT", entryPath: "story_reply", setterStage: "opener", paused: false } },
  { conversationId: "m3", igUserId: "103", username: "jordan.ops", preview: "100%. what would that look like", hours: 2,
    contact: { id: "c3", kind: "SALES", kindSource: "entry", stage: "CALL_OFFERED", entryPath: "comment", setterStage: "bridge", paused: false } },
  { conversationId: "m4", igUserId: "104", username: "alex.friend", preview: "yes! 7pm", hours: 5,
    contact: { id: "c4", kind: "PERSONAL", kindSource: "user", stage: "NEW", entryPath: null, setterStage: null, paused: false } },
  { conversationId: "m5", igUserId: "105", username: "priya.studio", preview: "nice, how's it going so far?", hours: 26,
    contact: { id: "c5", kind: "UNSORTED", kindSource: null, stage: "NEW", entryPath: null, setterStage: null, paused: false } },
  { conversationId: "m6", igUserId: "106", username: "lena.fit", preview: "booked for thursday!", hours: 30,
    contact: { id: "c6", kind: "SALES", kindSource: "entry", stage: "CALL_BOOKED", entryPath: "keyword_dm", setterStage: "booked", paused: false } },
  { conversationId: "m7", igUserId: "107", username: "growthguru_99", preview: "Hey! Want to grow your page 10x?", hours: 80,
    contact: { id: "c7", kind: "UNSORTED", kindSource: null, stage: "NEW", entryPath: null, setterStage: null, paused: false } },
];

export function mockThreads(): InboxThread[] {
  return people.map(({ hours, ...t }) => ({ ...t, updatedTime: hoursAgo(hours) }));
}

export function mockMessages(conversationId: string): InboxMessage[] {
  const t = people.find((p) => p.conversationId === conversationId);
  if (!t) return [];
  return [
    { id: `${conversationId}-1`, text: "hey! saw your reel about the AI setter", fromMe: false, createdTime: hoursAgo(t.hours + 3) },
    { id: `${conversationId}-2`, text: "appreciate you reaching out 🙌 what caught your eye?", fromMe: true, createdTime: hoursAgo(t.hours + 2.5) },
    { id: `${conversationId}-3`, text: t.preview ?? "", fromMe: false, createdTime: hoursAgo(t.hours) },
  ];
}

/** Kind and stage changes made while running on sample data. Kept in memory
 *  so the controls work in a local demo; gone on restart. */
export function updateMockContact(contactId: string, data: { kind?: string; stage?: string }) {
  const person = people.find((p) => p.contact?.id === contactId);
  if (!person?.contact) return;
  if (data.kind) person.contact.kind = data.kind as typeof person.contact.kind;
  if (data.stage) person.contact.stage = data.stage as typeof person.contact.stage;
}
