// Follow-ups IO that outlived the old Friday list: the sidebar number, the
// legacy Friday flag (kept in step with the follow-up-friday tag) and the
// OS_MOCK sample state the sequences read.

import { setFridayTag, type TagWriteDb } from "@/lib/os/fields/write";
import { prisma } from "@/lib/db/client";
import { appendMockMessage, mockThreads, osMockEnabled, updateMockContact } from "@/lib/os/mock";
import { iso, newRecord, type SetterRecord } from "@/lib/os/setter/state";
import { setterStore } from "@/lib/os/setter/store";

const HOUR = 3600_000;

const mockFu: { seeded: boolean } = ((globalThis as { __osMockFollowups?: { seeded: boolean } }).__osMockFollowups ??= { seeded: false });

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

/** The sidebar number: the same as the Follow-ups "Yours to do" tab (calls
 *  to mark, Kevin's tasks, broadcasts that need a link or a review). J's
 *  drafted steps show on Scheduled and in the Inbox count instead. */
export async function followupsDue(workspaceId: string, now: Date = new Date()): Promise<number> {
  const { loadFollowupScreen } = await import("@/lib/os/sequences/view");
  const { broadcastNeeds } = await import("@/lib/os/broadcasts/engine");
  const [screen, needs] = await Promise.all([loadFollowupScreen(workspaceId, now).catch(() => null), broadcastNeeds(workspaceId, { now }).catch(() => [])]);
  return (screen ? screen.attendance.length + screen.tasks.length : 0) + needs.length;
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
  await setFridayTag(prisma as unknown as TagWriteDb, workspaceId, contactIds, on);
  return { count: r.count };
}
