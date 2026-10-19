import { describe, expect, it } from "vitest";
import { defaultCalendarSettings } from "../../lib/os/integrations/calendar/settings";
import { bookingOf, calendarForSetter, fallbackDue, normalizeSetterBooking } from "../../lib/os/integrations/calendar/setter-booking";
import type { ActiveCalendar } from "../../lib/os/integrations/calendar/store";
import type { CalendarProvider, CalendarSlot } from "../../lib/os/integrations/calendar/types";
import { bookingBlock, type BookingContext } from "../../lib/os/setter/booking";
import { renderBrandBlock } from "../../lib/os/setter/profile";
import { newRecord } from "../../lib/os/setter/state";

const NOW = new Date("2026-10-19T08:00:00Z");
const LINK = "https://cal.com/kevin/setter-build";

function ctx(slots: CalendarSlot[], booking = normalizeSetterBooking({ mode: "calendar", link: LINK })): BookingContext {
  const settings = calendarForSetter({ ...defaultCalendarSettings(), hostTimezone: "Europe/Lisbon" }, booking)!;
  const calendar: ActiveCalendar = {
    provider: "mock",
    client: {} as CalendarProvider,
    settings,
    eventTypeId: "42",
    eventName: "Setter Build intro",
    durationMinutes: 30,
    fallbackLink: booking.link,
    fallbackAfterHours: booking.fallbackAfterHours,
  };
  return { calendar, slots, options: slots.slice(0, 2), leadTz: "Europe/London", mode: "book" };
}

const slot = (start: string): CalendarSlot => ({ start, end: null });

describe("Setup › Booking: calendar or link", () => {
  it("defaults to calendar mode, 2 times within 3 days, 24h fallback", () => {
    expect(normalizeSetterBooking({})).toMatchObject({ mode: "calendar", propose: 2, withinDays: 3, fallbackAfterHours: 24, link: null, configured: true });
    expect(bookingOf({}).configured).toBe(false);
    expect(normalizeSetterBooking({ mode: "link", propose: 9, withinDays: 0, link: "javascript:alert(1)" })).toMatchObject({ mode: "link", propose: 3, withinDays: 1, link: null });
  });

  it("calendar mode proposes N times within D days; link mode turns the calendar off", () => {
    const cal = { ...defaultCalendarSettings(), options: 3, daysAhead: 7 };
    expect(calendarForSetter(cal, normalizeSetterBooking({ mode: "calendar" }))).toMatchObject({ options: 2, daysAhead: 3 });
    expect(calendarForSetter(cal, normalizeSetterBooking({ mode: "link", link: LINK }))).toBeNull();
    // never configured: the spec's rule, 2 times within 3 days
    expect(calendarForSetter(cal, bookingOf({}))).toMatchObject({ options: 2, daysAhead: 3 });
  });

  it("no free time → J sends the fallback link instead of 'this week is packed'", () => {
    const block = bookingBlock(ctx([]), newRecord("c", "jordan.ops", "c"), NOW);
    expect(block).toContain(`Send the booking link so they pick a time themselves: ${LINK}`);
    expect(block).toContain("NO free times in the next 3 days");
  });

  it("neither time works → the link, not more times", () => {
    const block = bookingBlock(ctx([slot("2026-10-20T13:00:00Z"), slot("2026-10-21T10:00:00Z")]), newRecord("c", "jordan.ops", "c"), NOW);
    expect(block).toContain(`send the booking link so they pick what works: ${LINK}`);
    expect(block).not.toContain("offer the two closest listed ones");
  });

  it("no pick within 24h → send the link", () => {
    const rec = newRecord("c", "jordan.ops", "c");
    rec.booking = { phase: "proposed", at: "2026-10-18T06:00:00Z", proposed: ["2026-10-20T13:00:00Z"] };
    expect(fallbackDue(rec.booking.at, { fallbackAfterHours: 24 }, NOW)).toBe(true);
    expect(bookingBlock(ctx([slot("2026-10-20T13:00:00Z")]), rec, NOW)).toContain("since you offered times with no pick");
    expect(fallbackDue("2026-10-19T07:00:00Z", { fallbackAfterHours: 24 }, NOW)).toBe(false);
  });

  it("the setter's booking link is the link J sends in the brand block", () => {
    const p = {
      name: "J",
      settings: { cal_com_url: "https://old.example/x", booking: { mode: "link", link: LINK } },
      business: { sections: { booking_link: "https://older.example/y" }, objections: [] },
      offers: [],
      funnel: [],
      voice: "",
      voiceExamples: "",
      examples: "",
      voiceCorrections: [],
    };
    expect(renderBrandBlock(p, [], "2026-10-19")).toContain(`### Booking link (the ONLY link you send at the bridge)\n${LINK}`);
  });
});
