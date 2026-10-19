// OS_MOCK=1 sample state for follow-ups, so every branch can be clicked
// through on the sample inbox:
//   lena.fit     booked for tomorrow: nurture + day-before + on-the-day queued
//   chris.makes  missed his call 3h ago: the no-show check-in is drafted
//   ava.creates  showed yesterday: your voice-note task, with her goal and pain
//   sam.creates  quiet mid-qualifying: "value first" drafted
//   jordan.ops   quiet after the invite: "value first" queued for tomorrow
// In memory, gone on restart, like the rest of the sample data.

import { seedFollowupsMock } from "@/lib/os/followups-data";
import { mockContactExtras, mockThreads, osMockEnabled } from "@/lib/os/mock";
import { mockBookingRows } from "@/lib/os/setter/booking-store";
import { iso, newRecord, type SetterRecord } from "@/lib/os/setter/state";
import { setterStore } from "@/lib/os/setter/store";
import { createVoiceNoteTask, syncFollowups } from "@/lib/os/sequences/engine";
import { sequenceStore } from "@/lib/os/sequences/store";

const HOUR = 3600_000;
const flag = globalThis as { __osMockSequencesSeeded?: boolean };

async function deliverDue(now: Date) {
  const { deliverStep } = await import("@/lib/os/sequences/deliver");
  for (const s of await sequenceStore().listLive("mock")) {
    if (s.status === "QUEUED" && new Date(s.dueAt).getTime() <= now.getTime()) await deliverStep(s.id, { now, schedule: async () => {} }).catch(() => null);
  }
}

/** Without a worker (sample data), due steps are drafted when a screen loads. */
export async function mockFollowupTick(now = new Date()) {
  if (!osMockEnabled()) return;
  await seedMockSequences();
  await deliverDue(now);
}

export async function seedMockSequences() {
  if (!osMockEnabled() || flag.__osMockSequencesSeeded) return;
  flag.__osMockSequencesSeeded = true;
  await seedFollowupsMock();
  const store = setterStore();
  const bookings = mockBookingRows();
  const now = Date.now();
  const at = (h: number) => new Date(now + h * HOUR).toISOString();
  const threads = new Map(mockThreads().map((t) => [t.contact?.id, t]));

  const put = async (id: string, edit: (r: SetterRecord) => void) => {
    const t = threads.get(id);
    const c = await store.getContact(id, "mock");
    if (!t || !c) return;
    const rec = (await store.loadState(id)) ?? newRecord(t.conversationId, t.username ?? "", id);
    rec.their_last_at = iso(t.updatedTime ? new Date(t.updatedTime) : null);
    rec.our_last_at = rec.our_last_at ?? iso(new Date(new Date(t.updatedTime ?? at(0)).getTime() - 2.5 * HOUR));
    edit(rec);
    await store.saveState(c, rec);
  };
  const book = (id: string, contactId: string, startH: number, createdH: number, extra: Record<string, unknown> = {}) => {
    const start = at(startH);
    bookings.set(id, {
      id,
      draftId: `sample-${id}`,
      contactId,
      provider: "mock",
      eventTypeId: "mock-setter-call",
      eventName: "Setter call",
      externalId: null,
      start,
      end: at(startH + 0.5),
      timezone: "Europe/London",
      name: null,
      email: mockContactExtras(contactId).email ?? "sample@example.com",
      status: "CONFIRMED",
      url: null,
      confirmedAt: at(createdH + 1),
      createdAt: at(createdH),
      ...extra,
    });
    return start;
  };

  // lena.fit: booked yesterday for tomorrow afternoon.
  const lenaCall = book("sample-booking-lena", "c6", 26, -20);
  await put("c6", (r) => {
    r.state = "booked";
    r.stage = "booked";
    r.booking = { phase: "confirmed", timezone: "Europe/London", start: lenaCall, booking_id: "sample-booking-lena", at: at(-19) };
  });

  // chris.makes: the call was 3 hours ago and he didn't come.
  const chrisCall = book("sample-booking-chris", "c11", -3, -27, { attendance: "NO_SHOW", attendanceSource: "user", attendanceAt: at(-2) });
  await put("c11", (r) => {
    r.state = "booked";
    r.stage = "booked";
    r.booking = { phase: "confirmed", timezone: "Europe/London", start: chrisCall, booking_id: "sample-booking-chris", at: at(-26) };
  });

  // ava.creates: came to yesterday's call. Your move: a personal voice note.
  const avaCall = book("sample-booking-ava", "c12", -18, -40, { attendance: "SHOWED", attendanceSource: "user", attendanceAt: at(-17) });
  await put("c12", (r) => {
    r.state = "booked";
    r.stage = "booked";
    r.booking = { phase: "confirmed", timezone: "Europe/London", start: avaCall, booking_id: "sample-booking-ava", at: at(-39) };
  });
  const ava = await store.getContact("c12", "mock");
  if (ava) {
    const task = await createVoiceNoteTask(ava, "sample-booking-ava", avaCall);
    // Sample goal and pain (on live data they come from J's invite, in their words).
    Object.assign(task.context, { goal: "10k a month from Instagram without posting every day", pain: "DMs pile up and there's no system for following up" });
  }

  for (const t of mockThreads()) if (t.contact?.kind === "SALES") await syncFollowups(t.contact.id, { workspaceId: "mock", schedule: async () => {} }).catch(() => null);
  await deliverDue(new Date());
}
