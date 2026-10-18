// Calendly API v2 with a personal access token (Integrations & apps → API and
// webhooks). https://developer.calendly.com
//
// Booking goes through the Scheduling API (POST /invitees), which Calendly
// only opens to paid plans (Standard and above); the Free plan gets a 403.
// Then createBooking throws CalendarApiError "plan" and J falls back to the
// link Calendly gives for that exact time (event_type_available_times →
// scheduling_url), with their name and email prefilled.
import { calFetch } from "./http";
import { slotId } from "./slots";
import type { Attendee, BookingOutcome, CalendarEventType, CalendarProvider, CalendarSlot } from "./types";

const BASE = "https://api.calendly.com";
/** Calendly caps one availability read; a week per call stays well inside it. */
const WINDOW_MS = 7 * 86_400_000;

type Me = { resource?: { uri?: string; name?: string; email?: string; timezone?: string } };

/** The slot's scheduling page with name and email filled in (Calendly reads
 *  ?name= and ?email= on any booking page). */
export function prefilledLink(url: string, name: string | null, email: string | null): string {
  try {
    const u = new URL(url);
    if (name) u.searchParams.set("name", name);
    if (email) u.searchParams.set("email", email);
    return u.toString();
  } catch {
    return url;
  }
}

export function createCalendly(token: string, base = BASE): CalendarProvider {
  const headers = { Authorization: `Bearer ${token}` };
  let me: Me["resource"] | null = null;
  const whoAmI = async () => (me ??= (await calFetch<Me>("calendly", `${base}/users/me`, { headers })).resource ?? {});

  return {
    id: "calendly",
    async verify() {
      const r = await whoAmI();
      return { name: r.name ?? null, email: r.email ?? null, timezone: r.timezone ?? null };
    },
    async listEventTypes(): Promise<CalendarEventType[]> {
      const user = (await whoAmI()).uri;
      if (!user) return [];
      const q = new URLSearchParams({ user, active: "true", count: "100" });
      const res = await calFetch<{ collection?: { uri: string; name?: string; duration?: number; active?: boolean }[] }>("calendly", `${base}/event_types?${q}`, { headers });
      return (res.collection ?? []).map((e) => ({ id: e.uri, name: e.name || "Event", durationMinutes: typeof e.duration === "number" ? e.duration : null }));
    },
    async getAvailableSlots(eventTypeId, range): Promise<CalendarSlot[]> {
      const out: CalendarSlot[] = [];
      // Calendly refuses a start in the past.
      let from = Math.max(range.start.getTime(), Date.now() + 60_000);
      while (from < range.end.getTime()) {
        const to = Math.min(range.end.getTime(), from + WINDOW_MS);
        const q = new URLSearchParams({ event_type: eventTypeId, start_time: new Date(from).toISOString(), end_time: new Date(to).toISOString() });
        const res = await calFetch<{ collection?: { status?: string; start_time: string; scheduling_url?: string; invitees_remaining?: number }[] }>(
          "calendly",
          `${base}/event_type_available_times?${q}`,
          { headers }
        );
        for (const s of res.collection ?? []) {
          if (s.status && s.status !== "available") continue;
          if (typeof s.invitees_remaining === "number" && s.invitees_remaining <= 0) continue;
          out.push({ start: slotId(s.start_time), end: null, bookingUrl: s.scheduling_url ?? null });
        }
        from = to;
      }
      return out;
    },
    async createBooking(eventTypeId, slot, a: Attendee): Promise<BookingOutcome> {
      const res = await calFetch<{ resource?: { uri?: string; event?: string; reschedule_url?: string; cancel_url?: string } }>("calendly", `${base}/invitees`, {
        method: "POST",
        booking: true,
        headers,
        body: {
          event_type: eventTypeId,
          start_time: slotId(slot.start),
          invitee: { name: a.name, email: a.email, timezone: a.timezone },
          tracking: { utm_source: "instagram", utm_medium: "dm", utm_campaign: "dm-os" },
        },
      });
      const r = res.resource ?? {};
      return { kind: "booked", externalId: r.uri ?? r.event ?? null, start: slotId(slot.start), end: slot.end ?? null, url: r.reschedule_url ?? null };
    },
    async cancel(externalId, reason) {
      // externalId is the invitee uri: …/scheduled_events/<event>/invitees/<id>
      const event = /scheduled_events\/([^/]+)/.exec(externalId)?.[1];
      if (!event) return;
      await calFetch("calendly", `${base}/scheduled_events/${encodeURIComponent(event)}/cancellation`, {
        method: "POST",
        headers,
        body: { reason: reason ?? "Cancelled from DM OS" },
      });
    },
  };
}
