import { afterEach, describe, expect, it, vi } from "vitest";
import { createCalcom, CALCOM_VERSIONS } from "../../lib/os/integrations/calendar/calcom";
import { createCalendly, prefilledLink } from "../../lib/os/integrations/calendar/calendly";
import { defaultCalendarSettings, eventTypeFor, normalizeCalendarSettings, type CalendarSettings } from "../../lib/os/integrations/calendar/settings";
import { bookingSummary, filterSlots, formatSlot, formatTime, guessTimezone, pickOptions } from "../../lib/os/integrations/calendar/slots";
import type { ActiveCalendar } from "../../lib/os/integrations/calendar/store";
import { CalendarApiError, type BookingPayload, type CalendarProvider, type CalendarSlot } from "../../lib/os/integrations/calendar/types";
import { applyBookingReply, bookingBlock, loadBookingContext, readBookingReply, wantsCalendar } from "../../lib/os/setter/booking";
import type { BookingRecord, BookingStore, CalendarSource } from "../../lib/os/setter/booking-store";
import { fileKnowledgeSource } from "../../lib/os/setter/knowledge";
import { approveDraft, draftForContact } from "../../lib/os/setter/service";
import { hasAttachment, newRecord, observe, type SetterRecord, type ThreadMessage } from "../../lib/os/setter/state";
import type { DraftView, NewDraft, SetterContact, SetterStore } from "../../lib/os/setter/store";

// Monday 19 Oct 2026, 08:00 UTC = 09:00 in Lisbon (WEST, UTC+1).
const NOW = new Date("2026-10-19T08:00:00Z");

const settings: CalendarSettings = {
  ...defaultCalendarSettings(),
  hostTimezone: "Europe/Lisbon",
  minNoticeHours: 2,
  daysAhead: 7,
  options: 2,
  eventTypes: { default: "42" },
  eventTypeInfo: { "42": { name: "Intro call", durationMinutes: 30 } },
};

/** Half-hourly UTC slots over the next week (the provider's view). */
function weekOfSlots(): CalendarSlot[] {
  const out: CalendarSlot[] = [];
  for (let t = NOW.getTime(); t < NOW.getTime() + 8 * 86_400_000; t += 1_800_000) {
    out.push({ start: new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z"), end: null });
  }
  return out;
}

describe("slot selection and timezones", () => {
  it("keeps working hours, notice and weekdays in the host's timezone", () => {
    const kept = filterSlots(weekOfSlots(), settings, NOW, 30);
    expect(kept.length).toBeGreaterThan(0);
    // 2h notice: nothing before 10:00 UTC on Monday.
    expect(kept[0].start).toBe("2026-10-19T10:00:00Z");
    for (const s of kept) {
      const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", hour: "numeric", hourCycle: "h23" }).format(new Date(s.start)));
      expect(h).toBeGreaterThanOrEqual(9);
      expect(h).toBeLessThan(18);
      const wd = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Lisbon", weekday: "short" }).format(new Date(s.start));
      expect(["Sat", "Sun"]).not.toContain(wd);
    }
    // The last start leaves room for a 30 min call before 18:00 Lisbon (17:00 UTC).
    expect(kept.some((s) => s.start.endsWith("T16:30:00Z"))).toBe(true);
    expect(kept.some((s) => s.start.endsWith("T17:00:00Z"))).toBe(false);
  });

  it("offers two times on different days and halves of the day, in their hours", () => {
    const kept = filterSlots(weekOfSlots(), settings, NOW, 30);
    const opts = pickOptions(kept, 2, "America/New_York");
    expect(opts).toHaveLength(2);
    const ny = opts.map((o) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23", day: "numeric" }).formatToParts(new Date(o.start)));
    const hours = ny.map((p) => Number(p.find((x) => x.type === "hour")!.value));
    const days = ny.map((p) => p.find((x) => x.type === "day")!.value);
    expect(days[0]).not.toBe(days[1]);
    for (const h of hours) {
      expect(h).toBeGreaterThanOrEqual(8);
      expect(h).toBeLessThan(20);
    }
    expect(pickOptions(kept, 2, null, [kept[0].start])[0].start).not.toBe(kept[0].start);
  });

  it("formats in the lead's timezone, Kevin's way", () => {
    expect(formatSlot("2026-10-21T14:00:00Z", "Europe/Lisbon")).toBe("Wednesday 21 Oct, 3pm");
    expect(formatSlot("2026-10-21T14:30:00Z", "America/New_York")).toBe("Wednesday 21 Oct, 10:30am");
    expect(formatTime("2026-10-21T14:00:00Z", "Asia/Kolkata")).toBe("7:30pm");
    expect(bookingSummary({ start: "2026-10-21T14:00:00Z", timezone: "America/New_York", hostTimezone: "Europe/Lisbon" })).toBe(
      "Wednesday 21 Oct, 10am their time (3pm yours)"
    );
  });

  it("guesses their timezone from what they said, newest first", () => {
    expect(guessTimezone(["I'm in london", "actually moved to Lisbon last year"])).toBe("Europe/Lisbon");
    expect(guessTimezone(["east coast, NYC"])).toBe("America/New_York");
    expect(guessTimezone(["I'm based in Bangalore"])).toBe("Asia/Kolkata");
    expect(guessTimezone(["sounds good"])).toBeNull();
    expect(guessTimezone(["the best way to grow"])).toBeNull();
  });

  it("reads stored settings defensively", () => {
    const s = normalizeCalendarSettings({ workStart: 20, workEnd: 8, options: 9, hostTimezone: "Mars/Base", eventTypes: { default: "1", s1: "2" } });
    expect(s.workEnd).toBe(21);
    expect(s.options).toBe(3);
    expect(s.hostTimezone).toBe("UTC");
    expect(eventTypeFor(s, "s1")).toBe("2");
    expect(eventTypeFor(s, "other")).toBe("1");
  });
});

// ---------------------------------------------------------------- providers (mocked fetch)
function mockFetch(handler: (url: string, init: RequestInit) => { status?: number; body?: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const r = handler(url, init);
      return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status ?? 200 });
    })
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("Cal.com provider", () => {
  it("reads slots and books with the pinned API versions", async () => {
    const calls = mockFetch((url) => {
      if (url.includes("/slots")) return { body: { status: "success", data: { "2026-10-21": [{ start: "2026-10-21T15:00:00.000+01:00", end: "2026-10-21T15:30:00.000+01:00" }] } } };
      if (url.endsWith("/bookings")) return { status: 201, body: { status: "success", data: { id: 7, uid: "bk_1", start: "2026-10-21T14:00:00.000Z", end: "2026-10-21T14:30:00.000Z" } } };
      return { body: { status: "success", data: [{ id: 42, title: "Intro call", lengthInMinutes: 30 }] } };
    });
    const cal = createCalcom("cal_live_test");
    expect(await cal.listEventTypes()).toEqual([{ id: "42", name: "Intro call", durationMinutes: 30 }]);
    const slots = await cal.getAvailableSlots("42", { start: NOW, end: new Date(NOW.getTime() + 86_400_000) }, "Europe/Lisbon");
    expect(slots).toEqual([{ start: "2026-10-21T14:00:00Z", end: "2026-10-21T14:30:00Z" }]);
    const out = await cal.createBooking("42", slots[0], { name: "Sam", email: "sam@x.io", timezone: "America/New_York" });
    expect(out).toMatchObject({ kind: "booked", externalId: "bk_1", start: "2026-10-21T14:00:00Z" });

    const slotCall = calls.find((c) => c.url.includes("/slots"))!;
    expect((slotCall.init.headers as Record<string, string>)["cal-api-version"]).toBe(CALCOM_VERSIONS.slots);
    expect(slotCall.url).toContain("eventTypeId=42");
    const bookCall = calls.find((c) => c.url.endsWith("/bookings"))!;
    expect((bookCall.init.headers as Record<string, string>)["cal-api-version"]).toBe(CALCOM_VERSIONS.bookings);
    expect((bookCall.init.headers as Record<string, string>).Authorization).toBe("Bearer cal_live_test");
    expect(JSON.parse(String(bookCall.init.body))).toMatchObject({
      start: "2026-10-21T14:00:00Z",
      eventTypeId: 42,
      attendee: { name: "Sam", email: "sam@x.io", timeZone: "America/New_York" },
    });
  });

  it("maps a refused booking to slot_taken", async () => {
    mockFetch(() => ({ status: 400, body: { status: "error", error: { message: "User either already has booking at this time or is not available" } } }));
    const err = await createCalcom("k")
      .createBooking("42", { start: "2026-10-21T14:00:00Z" }, { name: "a", email: "a@b.co", timezone: "UTC" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(CalendarApiError);
    expect(err.code).toBe("slot_taken");
    expect(err.message).not.toContain("already has booking");
  });
});

describe("Calendly provider", () => {
  it("lists event types for the token's user, reads available times and books via /invitees", async () => {
    const calls = mockFetch((url) => {
      if (url.endsWith("/users/me")) return { body: { resource: { uri: "https://api.calendly.com/users/U1", name: "Kevin", timezone: "Europe/Lisbon" } } };
      if (url.includes("/event_types?")) return { body: { collection: [{ uri: "https://api.calendly.com/event_types/E1", name: "Intro", duration: 30 }] } };
      if (url.includes("/event_type_available_times")) {
        return {
          body: {
            collection: [
              { status: "available", start_time: "2030-10-21T14:00:00Z", invitees_remaining: 1, scheduling_url: "https://calendly.com/kevin/intro/2030-10-21T14:00:00Z" },
              { status: "available", start_time: "2030-10-21T15:00:00Z", invitees_remaining: 0, scheduling_url: "https://calendly.com/x" },
            ],
          },
        };
      }
      if (url.endsWith("/invitees")) return { status: 201, body: { resource: { uri: "https://api.calendly.com/scheduled_events/EV/invitees/I1", reschedule_url: "https://calendly.com/r/1" } } };
      return { status: 404 };
    });
    const cal = createCalendly("pat");
    expect(await cal.listEventTypes()).toEqual([{ id: "https://api.calendly.com/event_types/E1", name: "Intro", durationMinutes: 30 }]);
    const start = new Date("2030-10-20T00:00:00Z");
    const slots = await cal.getAvailableSlots("https://api.calendly.com/event_types/E1", { start, end: new Date(start.getTime() + 3 * 86_400_000) }, "UTC");
    expect(slots).toEqual([{ start: "2030-10-21T14:00:00Z", end: null, bookingUrl: "https://calendly.com/kevin/intro/2030-10-21T14:00:00Z" }]);
    const out = await cal.createBooking("https://api.calendly.com/event_types/E1", slots[0], { name: "Sam", email: "sam@x.io", timezone: "America/New_York" });
    expect(out).toMatchObject({ kind: "booked", externalId: "https://api.calendly.com/scheduled_events/EV/invitees/I1" });
    const body = JSON.parse(String(calls.find((c) => c.url.endsWith("/invitees"))!.init.body));
    expect(body).toMatchObject({ event_type: "https://api.calendly.com/event_types/E1", start_time: "2030-10-21T14:00:00Z", invitee: { email: "sam@x.io", timezone: "America/New_York" } });
  });

  it("a Free plan's 403 on booking is 'plan' (the link fallback), and the link is prefilled", async () => {
    mockFetch(() => ({ status: 403, body: { title: "Permission Denied", message: "Upgrade your plan" } }));
    const err = await createCalendly("pat")
      .createBooking("E1", { start: "2030-10-21T14:00:00Z" }, { name: "Sam", email: "sam@x.io", timezone: "UTC" })
      .catch((e) => e);
    expect(err.code).toBe("plan");
    expect(prefilledLink("https://calendly.com/kevin/intro/2030-10-21T14:00:00Z?month=2030-10", "Sam O", "sam@x.io")).toBe(
      "https://calendly.com/kevin/intro/2030-10-21T14:00:00Z?month=2030-10&name=Sam+O&email=sam%40x.io"
    );
  });
});

// ---------------------------------------------------------------- J's booking flow
function fakeCalendar(opts: { taken?: Set<string>; plan?: boolean; provider?: "calcom" | "calendly"; direct?: boolean } = {}) {
  const booked: { start: string; email: string }[] = [];
  const client: CalendarProvider = {
    id: opts.provider ?? "calcom",
    verify: async () => ({ name: "Kevin", email: null, timezone: "Europe/Lisbon" }),
    listEventTypes: async () => [{ id: "42", name: "Intro call", durationMinutes: 30 }],
    getAvailableSlots: async () => weekOfSlots().map((s) => ({ ...s, bookingUrl: `https://calendly.com/kevin/intro/${s.start}` })),
    createBooking: async (_e, slot, a) => {
      if (opts.plan) throw new CalendarApiError("calendly", 403, "plan");
      if (opts.taken?.has(slot.start)) throw new CalendarApiError("calcom", 409, "slot_taken");
      booked.push({ start: slot.start, email: a.email });
      return { kind: "booked", externalId: `ext-${slot.start}`, start: slot.start, end: null, url: null };
    },
  };
  const active: ActiveCalendar = {
    provider: opts.provider ?? "calcom",
    client,
    settings: { ...settings, directBooking: opts.direct ?? true },
    eventTypeId: "42",
    eventName: "Intro call",
    durationMinutes: 30,
  };
  const noDirect: string[] = [];
  const source: CalendarSource = {
    forSetter: async () => active,
    provider: async () => client,
    noDirectBooking: async (_w, p) => void noDirect.push(p),
  };
  return { source, booked, noDirect, active };
}

function memoryBookings() {
  const rows: (BookingRecord & { draftId: string })[] = [];
  const confirmed: string[] = [];
  const emails: string[] = [];
  const store: BookingStore = {
    byDraft: async (id) => rows.find((r) => r.draftId === id) ?? null,
    create: async (input) => {
      const r = { ...input, id: `b${rows.length + 1}`, confirmedAt: null };
      rows.push(r);
      return r;
    },
    booked: async (_c, b) => void emails.push(b.email),
    confirm: async (c, id) => {
      confirmed.push(id ?? "?");
      const r = rows.find((x) => x.id === id);
      if (r) r.status = "CONFIRMED";
    },
    latest: async (_w, cid) => [...rows].reverse().find((r) => r.contactId === cid) ?? null,
  };
  return { store, rows, confirmed, emails };
}

/** The test's "now": sends are stamped with it. */
const clock = { now: NOW };
const stamp = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

function memoryStore(contact: SetterContact, thread: ThreadMessage[]) {
  const states = new Map<string, SetterRecord>();
  const drafts = new Map<string, DraftView>();
  const sent: string[] = [];
  let seq = 0;
  const store: SetterStore = {
    getContact: async (id) => (id === contact.id ? contact : null),
    readThread: async () => thread,
    loadState: async (id) => (states.has(id) ? structuredClone(states.get(id)!) : null),
    saveState: async (c, rec) => void states.set(c.id, structuredClone(rec)),
    pendingDraft: async (id) => [...drafts.values()].find((d) => d.contactId === id && d.status === "PENDING") ?? null,
    createDraft: async (input: NewDraft) => {
      for (const d of drafts.values()) if (d.status === "PENDING") d.status = "DISCARDED";
      const d: DraftView = { ...input, id: `d${++seq}`, status: "PENDING", createdAt: NOW.toISOString() };
      drafts.set(d.id, d);
      return d;
    },
    getDraft: async (id) => drafts.get(id) ?? null,
    claimDraft: async (id) => {
      const d = drafts.get(id);
      if (d?.status !== "PENDING") return false;
      d.status = "APPROVED";
      return true;
    },
    markSent: async (id, s) => void Object.assign(drafts.get(id)!, { status: "SENT", bubbles: s.bubbles }),
    releaseDraft: async (id, error) => void Object.assign(drafts.get(id)!, { status: "PENDING", sendError: error }),
    discardDraft: async (id) => {
      const d = drafts.get(id);
      if (d?.status !== "PENDING") return false;
      d.status = "DISCARDED";
      return true;
    },
    listPending: async () => [...drafts.values()].filter((d) => d.status === "PENDING"),
    send: async (_c, text) => {
      sent.push(text);
      thread.push({ id: `out${sent.length}`, text, incoming: false, at: stamp(new Date(clock.now.getTime() + sent.length * 1000)) });
    },
    setSetterStage: async () => {},
  };
  return { store, states, drafts, sent };
}

const contact: SetterContact = {
  id: "c1",
  workspaceId: "w1",
  igUserId: "101",
  username: "sam",
  conversationId: "conv1",
  kind: "SALES",
  paused: false,
  tags: [],
  fullName: "Sam Ortega",
  stage: "CALL_OFFERED",
  setterStage: "bridge",
};
const knowledge = fileKnowledgeSource();
let t = 0;
const said = (text: string, at: Date = new Date(NOW.getTime() - 300_000)): ThreadMessage => ({ id: `in${++t}`, text, incoming: true, at: stamp(at) });
const mins = (n: number) => new Date(NOW.getTime() + n * 60_000);

describe("the booking prompt and J's answer", () => {
  it("only starts once a call is on the table", () => {
    const rec = newRecord("conv1", "sam");
    expect(wantsCalendar(rec, { stage: "IN_CONVERSATION", setterStage: "qualify" })).toBe(false);
    expect(wantsCalendar(rec, { stage: "CALL_OFFERED", setterStage: null })).toBe(true);
    expect(wantsCalendar({ ...rec, invited: { route: "call", at: "x" } }, { stage: "NEW", setterStage: null })).toBe(true);
  });

  it("lists real times in their timezone and asks for it when unknown", async () => {
    const { active } = fakeCalendar();
    const rec = newRecord("conv1", "sam");
    const unknown = await loadBookingContext(active, rec, [said("yeah let's do it")], NOW);
    expect(bookingBlock(unknown!, rec)).toContain("Their timezone: UNKNOWN");
    const known = await loadBookingContext(active, rec, [said("sure, I'm in NYC")], NOW);
    expect(known!.leadTz).toBe("America/New_York");
    const block = bookingBlock(known!, rec);
    expect(block).toContain("Do NOT send the booking link");
    expect(block).toMatch(/- 2026-10-\d\dT[\d:]+Z = \w+day \d+ Oct, [\d:]+(am|pm) their time · [\d:]+(am|pm) for you/);
    expect(known!.options).toHaveLength(2);
  });

  it("a confirm with a free time and an email becomes a booking draft; a made-up time doesn't", async () => {
    const { active } = fakeCalendar();
    const rec = newRecord("conv1", "sam");
    const ctx = (await loadBookingContext(active, rec, [said("I'm in NYC")], NOW))!;
    const slot = ctx.options[0].start;
    const ok = applyBookingReply(readBookingReply({ action: "confirm", slot, email: "Sam@X.io" }), ctx, rec, contact, ["done, booked you in"], NOW);
    expect(ok.kind).toBe("booking");
    expect(ok.payload).toMatchObject({ provider: "calcom", eventTypeId: "42", start: slot, timezone: "America/New_York", email: "sam@x.io", name: "Sam Ortega", mode: "book" });
    const fake = applyBookingReply(readBookingReply({ action: "confirm", slot: "2026-10-19T03:00:00Z", email: "sam@x.io" }), ctx, rec, contact, ["done"], NOW);
    expect(fake.kind).toBeNull();
    expect(fake.flags).toContain("slot_unavailable");
    const noEmail = applyBookingReply(readBookingReply({ action: "confirm", slot }), ctx, rec, contact, ["done"], NOW);
    expect(noEmail.flags).toContain("needs_email");
  });

  it("Calendly without API booking puts a prefilled link for that time in the bubbles", async () => {
    const { active } = fakeCalendar({ provider: "calendly", direct: false });
    const rec = newRecord("conv1", "sam");
    const ctx = (await loadBookingContext(active, rec, [said("I'm in London")], NOW))!;
    expect(bookingBlock(ctx, rec)).toContain("{booking_link}");
    const slot = ctx.options[0].start;
    const r = applyBookingReply(readBookingReply({ action: "confirm", slot, email: "sam@x.io" }), ctx, rec, contact, ["here you go: {booking_link}"], NOW);
    expect(r.payload?.mode).toBe("link");
    expect(r.bubbles[0]).toBe(`here you go: https://calendly.com/kevin/intro/${slot}?name=Sam+Ortega&email=sam%40x.io`);
  });
});

describe("booking draft → approve → book → send", () => {
  async function toBookingDraft(cal: ReturnType<typeof fakeCalendar>) {
    t = 0;
    const thread: ThreadMessage[] = [said("yes let's do a call, I'm in NYC [fake:book-propose]")];
    const mem = memoryStore(contact, thread);
    const bk = memoryBookings();
    const deps = { store: mem.store, knowledge, calendar: cal.source, bookings: bk.store };

    clock.now = NOW;
    const r1 = await draftForContact("c1", { ...deps, now: NOW });
    expect(r1.status).toBe("drafted");
    expect(r1.status === "drafted" && r1.draft.kind).toBe("reply");
    expect(await approveDraft((r1 as { draft: DraftView }).draft.id, "w1", { ...deps, now: () => NOW, gapMs: 0 })).toEqual({});
    const proposed = mem.states.get("c1")!.booking!;
    expect(proposed.phase).toBe("proposed");
    expect(proposed.timezone).toBe("America/New_York");
    expect(proposed.proposed).toHaveLength(2);

    thread.push(said("the first one works [fake:book-email]", mins(30)));
    clock.now = mins(60);
    const r2 = await draftForContact("c1", { ...deps, now: mins(60) });
    await approveDraft((r2 as { draft: DraftView }).draft.id, "w1", { ...deps, now: () => mins(60), gapMs: 0 });
    expect(mem.states.get("c1")!.booking!.phase).toBe("awaiting_email");

    // A bare email is the answer here, not an email-gate reply to skip.
    thread.push(said("[fake:book-confirm]", mins(89)));
    thread.push(said("sam@ortega.io", mins(90)));
    const later = mins(120);
    clock.now = later;
    const r3 = await draftForContact("c1", { ...deps, now: later });
    expect(r3.status).toBe("drafted");
    expect((r3 as { draft: DraftView }).draft.anchor).toBe(thread[thread.length - 1].id);
    const d = (r3 as { draft: DraftView }).draft;
    return { d, mem, bk, deps, thread, later };
  }

  it("Approve books first, then sends; the provider gets their email", async () => {
    const cal = fakeCalendar();
    const { d, mem, bk, deps, later } = await toBookingDraft(cal);
    expect(d.kind).toBe("booking");
    expect(d.flags).toContain("booking");
    // "booked" waits for their screenshot.
    expect(d.setterStage).toBe("bridge");
    expect(d.booking).toMatchObject({ email: "sam@ortega.io", timezone: "America/New_York", mode: "book" });
    const sentBefore = mem.sent.length;
    expect(cal.booked).toHaveLength(0); // drafting never books

    expect(await approveDraft(d.id, "w1", { ...deps, now: () => later, gapMs: 0 })).toEqual({});
    expect(cal.booked).toEqual([{ start: d.booking!.start, email: "sam@ortega.io" }]);
    expect(bk.rows[0]).toMatchObject({ status: "BOOKED", draftId: d.id, externalId: `ext-${d.booking!.start}` });
    expect(bk.emails).toEqual(["sam@ortega.io"]);
    expect(mem.sent.slice(sentBefore)).toEqual(d.bubbles);
    const rec = mem.states.get("c1")!;
    expect(rec.booking).toMatchObject({ phase: "booked", booking_id: "b1", start: d.booking!.start });
  });

  it("a taken time sends nothing, drops the draft and J offers new times", async () => {
    const cal = fakeCalendar();
    const { d, mem, bk, deps, later } = await toBookingDraft(cal);
    cal.source.provider = async () => fakeCalendar({ taken: new Set([d.booking!.start]) }).active.client;
    const sentBefore = mem.sent.length;
    const r = await approveDraft(d.id, "w1", { ...deps, now: () => later, gapMs: 0 });
    expect(r.rebook).toBe("slot_taken");
    expect(r.error).toMatch(/just taken, so nothing was sent/);
    expect(mem.sent.length).toBe(sentBefore);
    expect(bk.rows).toHaveLength(0);
    expect(mem.drafts.get(d.id)!.status).toBe("DISCARDED");
    const rec = mem.states.get("c1")!;
    expect(rec.booking!.taken).toEqual([d.booking!.start]);
    expect(rec.booking!.phase).toBe("proposed");

    // Re-propose: the taken time is gone from what J may offer.
    const ctx = await loadBookingContext(cal.active, rec, [], later);
    expect(ctx!.slots.map((s) => s.start)).not.toContain(d.booking!.start);
    expect(bookingBlock(ctx!, rec)).toContain("TAKEN since");
  });

  it("Calendly's plan refusal switches to the link and sends nothing", async () => {
    const cal = fakeCalendar({ provider: "calendly" });
    const { d, mem, deps, later } = await toBookingDraft(cal);
    cal.source.provider = async () => fakeCalendar({ plan: true }).active.client;
    const sentBefore = mem.sent.length;
    const r = await approveDraft(d.id, "w1", { ...deps, now: () => later, gapMs: 0 });
    expect(r.rebook).toBe("plan");
    expect(cal.noDirect).toEqual(["calendly"]);
    expect(mem.sent.length).toBe(sentBefore);
  });

  it("a send failure after booking never books twice on retry", async () => {
    const cal = fakeCalendar();
    const { d, mem, bk, deps, later } = await toBookingDraft(cal);
    const send = mem.store.send;
    mem.store.send = async () => {
      throw new Error("Meta said no");
    };
    const r = await approveDraft(d.id, "w1", { ...deps, now: () => later, gapMs: 0 });
    expect(r.error).toMatch(/call is booked, but the message didn't send/);
    mem.store.send = send;
    expect(await approveDraft(d.id, "w1", { ...deps, now: () => later, gapMs: 0 })).toEqual({});
    expect(cal.booked).toHaveLength(1);
    expect(bk.rows).toHaveLength(1);
  });

  it("their screenshot after the booking confirms it and J says thanks", async () => {
    const cal = fakeCalendar();
    const { d, mem, bk, deps, thread, later } = await toBookingDraft(cal);
    await approveDraft(d.id, "w1", { ...deps, now: () => later, gapMs: 0 });
    // Text after the booking is not a confirmation; an image is.
    const after = new Date(later.getTime() + 3600_000);
    thread.push(said("booked, see you then", new Date(later.getTime() + 1800_000)));
    thread.push({ id: "shot", text: "", incoming: true, at: stamp(after), attachment: "image" });
    const r = await draftForContact("c1", { ...deps, now: new Date(after.getTime() + 60_000) });
    expect(bk.confirmed).toEqual(["b1"]);
    expect(bk.rows[0].status).toBe("CONFIRMED");
    const rec = mem.states.get("c1")!;
    expect(rec.booking!.phase).toBe("confirmed");
    expect(rec.stage).toBe("booked");
    expect(r.status).toBe("drafted");
    expect((r as { draft: DraftView }).draft.anchor).toBe("shot");
  });
});

describe("screenshot detection", () => {
  it("counts images and Zernio's attachment text, not plain text", () => {
    expect(hasAttachment({ text: "", attachment: "image" })).toBe(true);
    expect(hasAttachment({ text: "[image attachment]" })).toBe(true);
    expect(hasAttachment({ text: "booked!" })).toBe(false);
  });

  it("only after the booking", () => {
    const rec: SetterRecord = { ...newRecord("c", "s"), booking: { phase: "booked", at: "2026-10-19T12:00:00Z", booking_id: "b1" } };
    const before = observe(rec, [{ id: "a", text: "", incoming: true, at: "2026-10-19T11:00:00Z", attachment: "image" }], [], [], NOW);
    expect(before.booking!.phase).toBe("booked");
    const after = observe(rec, [{ id: "b", text: "", incoming: true, at: "2026-10-19T13:00:00Z", attachment: "image" }], [], [], NOW);
    expect(after.booking).toMatchObject({ phase: "confirmed", confirmed_by: "b" });
    expect(after.last_incoming_text_id).toBe("b");
  });
});

// Keep the payload type exercised for tsc.
export type _P = BookingPayload;
