// The one shape every booking calendar implements (Cal.com, Calendly, the
// OS_MOCK sample). Pure: client components import the types.

export type CalendarProviderId = "calcom" | "calendly";
/** "mock" is the OS_MOCK sample calendar, never stored. */
export type CalendarSourceId = CalendarProviderId | "mock";
export const CALENDAR_PROVIDERS: CalendarProviderId[] = ["calcom", "calendly"];

export function isCalendarProvider(v: unknown): v is CalendarProviderId {
  return v === "calcom" || v === "calendly";
}

export interface CalendarEventType {
  /** Cal.com: the numeric id as a string. Calendly: the event type URI. */
  id: string;
  name: string;
  durationMinutes: number | null;
}

export interface CalendarSlot {
  /** UTC, seconds precision: "2026-10-21T14:00:00Z". Also the id J quotes back. */
  start: string;
  end?: string | null;
  /** Calendly: the scheduling page for exactly this time (the link fallback). */
  bookingUrl?: string | null;
}

export interface Attendee {
  name: string;
  email: string;
  /** IANA, e.g. "Europe/London". */
  timezone: string;
  notes?: string | null;
}

export type BookingOutcome =
  | { kind: "booked"; externalId: string | null; start: string; end: string | null; url: string | null }
  | { kind: "link"; url: string };

export interface CalendarAccount {
  name: string | null;
  email: string | null;
  timezone: string | null;
}

export interface CalendarProvider {
  id: CalendarSourceId;
  /** Checks the key; returns who it belongs to. */
  verify(): Promise<CalendarAccount>;
  listEventTypes(): Promise<CalendarEventType[]>;
  /** Free times for one event type, UTC starts, oldest first. */
  getAvailableSlots(eventTypeId: string, range: { start: Date; end: Date }, timezone: string): Promise<CalendarSlot[]>;
  /** Books it. The provider sends the calendar invite to the attendee. */
  createBooking(eventTypeId: string, slot: CalendarSlot, attendee: Attendee): Promise<BookingOutcome>;
  cancel?(externalId: string, reason?: string): Promise<void>;
}

/** Why a calendar call failed, in words the screen and J can act on. */
export type CalendarErrorCode = "auth" | "scope" | "plan" | "slot_taken" | "bad_request" | "not_found" | "rate_limited" | "unavailable" | "unknown";

/** The message never carries the response body (it can echo personal data). */
export class CalendarApiError extends Error {
  constructor(
    public provider: CalendarSourceId,
    public status: number,
    public code: CalendarErrorCode,
    message?: string
  ) {
    super(message ?? defaultMessage(provider, code, status));
    this.name = "CalendarApiError";
  }
}

export function calendarName(p: CalendarSourceId): string {
  return p === "calcom" ? "Cal.com" : p === "calendly" ? "Calendly" : "Sample calendar";
}

function defaultMessage(p: CalendarSourceId, code: CalendarErrorCode, status: number): string {
  const name = calendarName(p);
  switch (code) {
    case "auth":
      return `${name} rejected the key. Reconnect with a fresh one.`;
    case "scope":
      return `The ${name} key is missing a permission this needs.`;
    case "plan":
      return `${name} won't book from the API on this plan.`;
    case "slot_taken":
      return "That time was just taken.";
    case "not_found":
      return `${name} couldn't find that event type.`;
    case "bad_request":
      return `${name} refused the booking details.`;
    case "rate_limited":
      return `${name} is rate limiting. Try again in a minute.`;
    case "unavailable":
      return `${name} didn't respond. Try again.`;
    default:
      return `${name} request failed (HTTP ${status})`;
  }
}

/** What a booking draft carries (Draft.booking): everything Approve needs to
 *  book without asking the model again. */
export interface BookingPayload {
  provider: CalendarSourceId;
  eventTypeId: string;
  eventName: string | null;
  durationMinutes: number | null;
  /** UTC slot start (the slot id). */
  start: string;
  end: string | null;
  /** The lead's timezone, what the time was quoted in. */
  timezone: string;
  hostTimezone: string;
  name: string;
  email: string;
  /** "book" = Approve books through the API; "link" = Calendly without API
   *  booking: the bubbles carry a link for exactly this time. */
  mode: "book" | "link";
  url: string | null;
}

export function isBookingPayload(v: unknown): v is BookingPayload {
  const b = v as BookingPayload | null;
  return Boolean(b && typeof b === "object" && typeof b.start === "string" && typeof b.email === "string" && typeof b.eventTypeId === "string");
}
