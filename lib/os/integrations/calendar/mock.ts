// The OS_MOCK sample calendar: half-hour slots on weekdays, a few already
// busy, and an in-memory list of bookings so a second booking of the same
// time fails like a real "slot taken". OS_MOCK_CAL_TAKEN=1 makes every
// booking fail that way (to click the failure path).
import { slotId, zonedParts } from "./slots";
import { CalendarApiError, type CalendarProvider, type CalendarSlot } from "./types";

export const MOCK_EVENT_TYPE = { id: "mock-intro", name: "Intro call", durationMinutes: 30 };

const booked = ((globalThis as { __osMockCalBooked?: Set<string> }).__osMockCalBooked ??= new Set<string>());

/** Deterministic "busy" pattern so the offered times look real. */
function busy(start: Date): boolean {
  const n = Math.floor(start.getTime() / 1_800_000);
  return n % 5 === 0 || n % 7 === 0;
}

export function createMockCalendar(opts: { hostTimezone?: string; alwaysTaken?: boolean } = {}): CalendarProvider {
  const tz = opts.hostTimezone ?? "Europe/Lisbon";
  return {
    id: "mock",
    async verify() {
      return { name: "Sample calendar", email: null, timezone: tz };
    },
    async listEventTypes() {
      return [MOCK_EVENT_TYPE];
    },
    async getAvailableSlots(_eventTypeId, range) {
      const out: CalendarSlot[] = [];
      const step = 1_800_000;
      let t = Math.ceil(range.start.getTime() / step) * step;
      for (; t < range.end.getTime() && out.length < 400; t += step) {
        const d = new Date(t);
        const p = zonedParts(d, tz);
        if (p.weekday === 0 || p.weekday === 6 || p.hour < 9 || p.hour >= 18) continue;
        const id = slotId(d);
        if (busy(d) || booked.has(id)) continue;
        out.push({ start: id, end: slotId(new Date(t + step)), bookingUrl: `https://cal.example/sample/${encodeURIComponent(id)}` });
      }
      return out;
    },
    async createBooking(_eventTypeId, slot) {
      const id = slotId(slot.start);
      if (opts.alwaysTaken || process.env.OS_MOCK_CAL_TAKEN === "1" || booked.has(id)) throw new CalendarApiError("mock", 409, "slot_taken");
      booked.add(id);
      return { kind: "booked", externalId: `mock-${id}`, start: id, end: slot.end ?? null, url: null };
    },
    async cancel(externalId) {
      booked.delete(externalId.replace(/^mock-/, ""));
    },
  };
}
