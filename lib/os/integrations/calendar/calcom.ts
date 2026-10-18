// Cal.com API v2 with an API key (Settings → Developer → API Keys).
// https://cal.com/docs/api-reference/v2 — every endpoint pins its own
// cal-api-version header; without it Cal.com falls back to an older shape.
import { calFetch } from "./http";
import { slotId } from "./slots";
import { CalendarApiError, type Attendee, type BookingOutcome, type CalendarEventType, type CalendarProvider, type CalendarSlot } from "./types";

const BASE = "https://api.cal.com/v2";
export const CALCOM_VERSIONS = {
  slots: "2024-09-04",
  bookings: "2026-02-25",
  eventTypes: "2024-06-14",
} as const;

type Envelope<T> = { status?: string; data?: T };

export function createCalcom(apiKey: string, base = BASE): CalendarProvider {
  const auth = { Authorization: `Bearer ${apiKey}` };
  const get = <T>(path: string, version?: string) =>
    calFetch<Envelope<T>>("calcom", `${base}${path}`, { headers: { ...auth, ...(version ? { "cal-api-version": version } : {}) } });

  return {
    id: "calcom",
    async verify() {
      const me = await get<{ name?: string; email?: string; timeZone?: string; username?: string }>("/me");
      const d = me.data ?? {};
      return { name: d.name ?? d.username ?? null, email: d.email ?? null, timezone: d.timeZone ?? null };
    },
    async listEventTypes(): Promise<CalendarEventType[]> {
      const res = await get<{ id: number; title?: string; slug?: string; lengthInMinutes?: number; hidden?: boolean }[]>("/event-types", CALCOM_VERSIONS.eventTypes);
      return (Array.isArray(res.data) ? res.data : [])
        .filter((e) => e && e.id != null && !e.hidden)
        .map((e) => ({ id: String(e.id), name: e.title || e.slug || `Event ${e.id}`, durationMinutes: typeof e.lengthInMinutes === "number" ? e.lengthInMinutes : null }));
    },
    async getAvailableSlots(eventTypeId, range, timezone): Promise<CalendarSlot[]> {
      const q = new URLSearchParams({
        eventTypeId,
        start: range.start.toISOString(),
        end: range.end.toISOString(),
        timeZone: timezone,
        format: "range",
      });
      const res = await get<Record<string, { start: string; end?: string }[]>>(`/slots?${q}`, CALCOM_VERSIONS.slots);
      const days = res.data && typeof res.data === "object" ? res.data : {};
      return Object.values(days)
        .flat()
        .filter((s) => s?.start)
        .map((s) => ({ start: slotId(s.start), end: s.end ? slotId(s.end) : null }));
    },
    async createBooking(eventTypeId, slot, a: Attendee): Promise<BookingOutcome> {
      const id = Number(eventTypeId);
      if (!Number.isFinite(id)) throw new CalendarApiError("calcom", 400, "not_found");
      const res = await calFetch<Envelope<{ id?: number; uid?: string; start?: string; end?: string } | { uid?: string }[]>>("calcom", `${base}/bookings`, {
        method: "POST",
        booking: true,
        headers: { ...auth, "cal-api-version": CALCOM_VERSIONS.bookings },
        body: {
          start: slotId(slot.start),
          eventTypeId: id,
          attendee: { name: a.name, email: a.email, timeZone: a.timezone, language: "en" },
          metadata: { source: "dm-os" },
          ...(a.notes ? { bookingFieldsResponses: { notes: a.notes.slice(0, 500) } } : {}),
        },
      });
      if (res.status && res.status !== "success") throw new CalendarApiError("calcom", 400, "bad_request");
      const d = Array.isArray(res.data) ? res.data[0] : res.data;
      const b = (d ?? {}) as { id?: number; uid?: string; start?: string; end?: string };
      return {
        kind: "booked",
        externalId: b.uid ?? (b.id != null ? String(b.id) : null),
        start: b.start ? slotId(b.start) : slotId(slot.start),
        end: b.end ? slotId(b.end) : (slot.end ?? null),
        url: b.uid ? `https://app.cal.com/booking/${encodeURIComponent(b.uid)}` : null,
      };
    },
    async cancel(externalId, reason) {
      await calFetch("calcom", `${base}/bookings/${encodeURIComponent(externalId)}/cancel`, {
        method: "POST",
        headers: { ...auth, "cal-api-version": CALCOM_VERSIONS.bookings },
        body: { cancellationReason: reason ?? "Cancelled from DM OS" },
      });
    },
  };
}
