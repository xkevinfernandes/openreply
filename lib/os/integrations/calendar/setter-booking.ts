// Setup › Booking: how one setter books calls. Stored in Setter.settings.booking.
// Pure, so the editor, the calendar store and the tests share it.
//
//   calendar: J offers `propose` real times within `withinDays`, from the
//             connected calendar; if none fit (or no pick within
//             `fallbackAfterHours`) J sends `link` instead.
//   link:     J sends `link` and they pick a time themselves.
//
// No settings.booking = calendar mode with the integration's own numbers, which
// is how J booked before this screen existed.

import type { CalendarSettings } from "@/lib/os/integrations/calendar/settings";

export type BookingMode = "calendar" | "link";

export interface SetterBooking {
  mode: BookingMode;
  /** How many times J offers at once. */
  propose: number;
  /** Look this many days ahead. */
  withinDays: number;
  /** No pick after this long: send the link. */
  fallbackAfterHours: number;
  /** The booking link (link mode, and the calendar mode fallback). */
  link: string | null;
}

export const BOOKING_DEFAULTS: SetterBooking = { mode: "calendar", propose: 2, withinDays: 3, fallbackAfterHours: 24, link: null };

const int = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

export function isBookingLink(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 500) return false;
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Read settings.booking defensively. `configured` is false when it was never set. */
export function normalizeSetterBooking(raw: unknown): SetterBooking & { configured: boolean } {
  if (!raw || typeof raw !== "object") return { ...BOOKING_DEFAULTS, configured: false };
  const m = raw as Record<string, unknown>;
  return {
    mode: m.mode === "link" ? "link" : "calendar",
    propose: int(m.propose, 1, 3, BOOKING_DEFAULTS.propose),
    withinDays: int(m.withinDays, 1, 14, BOOKING_DEFAULTS.withinDays),
    fallbackAfterHours: int(m.fallbackAfterHours, 1, 168, BOOKING_DEFAULTS.fallbackAfterHours),
    link: isBookingLink(m.link) ? m.link.trim() : null,
    configured: true,
  };
}

export function bookingOf(settings: unknown): SetterBooking & { configured: boolean } {
  const s = (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>;
  return normalizeSetterBooking(s.booking);
}

/** The calendar settings J books with for this setter, or null in link mode. */
export function calendarForSetter(cal: CalendarSettings, booking: SetterBooking & { configured?: boolean }): CalendarSettings | null {
  if (booking.mode === "link") return null;
  if (booking.configured === false) return cal;
  return { ...cal, options: booking.propose, daysAhead: booking.withinDays };
}

/** Did they leave the offered times unanswered for too long? */
export function fallbackDue(proposedAt: string | null | undefined, booking: Pick<SetterBooking, "fallbackAfterHours">, now: Date): boolean {
  if (!proposedAt) return false;
  const t = new Date(proposedAt).getTime();
  return Number.isFinite(t) && now.getTime() - t > booking.fallbackAfterHours * 3600_000;
}
