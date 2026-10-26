// Where booked calls live (Booking) and the side effects of booking: the
// email lands on the Contact, a screenshot moves them to Call booked, and the
// CRMs hear about both. Postgres, or in memory with OS_MOCK=1.

import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { activeCalendar, disableDirectBooking, loadCalendarProvider, type ActiveCalendar } from "@/lib/os/integrations/calendar/store";
import type { CalendarProvider, CalendarSourceId } from "@/lib/os/integrations/calendar/types";
import { osEventHooks } from "@/lib/os/events-hooks";
import { fireContactEvent } from "@/lib/os/integrations/queue";
import { osMockEnabled, updateMockContact, updateMockContactExtras } from "@/lib/os/mock";
import type { SetterContact } from "@/lib/os/setter/store";

export type BookingStatusName = "BOOKED" | "CONFIRMED" | "LINK_SENT" | "CANCELLED";

export interface BookingRecord {
  id: string;
  contactId: string;
  provider: string;
  eventTypeId: string;
  eventName: string | null;
  externalId: string | null;
  start: string;
  end: string | null;
  timezone: string;
  name: string | null;
  email: string;
  status: BookingStatusName;
  url: string | null;
  confirmedAt: string | null;
}

export type NewBooking = Omit<BookingRecord, "id" | "confirmedAt"> & { workspaceId: string; draftId: string };

export interface BookingStore {
  byDraft(draftId: string): Promise<BookingRecord | null>;
  create(input: NewBooking): Promise<BookingRecord>;
  /** The booking went in: save their email on the contact, tell the CRMs. */
  booked(contact: SetterContact, booking: BookingRecord): Promise<void>;
  /** Their screenshot came in: booking CONFIRMED, contact to Call booked. */
  confirm(contact: SetterContact, bookingId: string | null, at: Date): Promise<void>;
  latest(workspaceId: string, contactId: string): Promise<BookingRecord | null>;
}

/** Which calendar J books on; injectable for tests. */
export interface CalendarSource {
  forSetter(workspaceId: string, setterId: string | null): Promise<ActiveCalendar | null>;
  provider(workspaceId: string, provider: CalendarSourceId): Promise<CalendarProvider | null>;
  noDirectBooking(workspaceId: string, provider: CalendarSourceId): Promise<void>;
}

export const calendarSource: CalendarSource = {
  forSetter: activeCalendar,
  async provider(workspaceId, provider) {
    return (await loadCalendarProvider(workspaceId, provider))?.client ?? null;
  },
  noDirectBooking: disableDirectBooking,
};

// ---------------------------------------------------------------- Postgres
type Row = Prisma.BookingGetPayload<object>;

function view(b: Row): BookingRecord {
  return {
    id: b.id,
    contactId: b.contactId,
    provider: b.provider,
    eventTypeId: b.eventTypeId,
    eventName: b.eventName,
    externalId: b.externalId,
    start: b.start.toISOString(),
    end: b.end?.toISOString() ?? null,
    timezone: b.timezone,
    name: b.name,
    email: b.email,
    status: b.status,
    url: b.url,
    confirmedAt: b.confirmedAt?.toISOString() ?? null,
  };
}

const dbBookings: BookingStore = {
  async byDraft(draftId) {
    const b = await prisma.booking.findUnique({ where: { draftId } });
    return b ? view(b) : null;
  },
  async create(input) {
    const b = await prisma.booking.create({
      data: { ...input, start: new Date(input.start), end: input.end ? new Date(input.end) : null },
    });
    return view(b);
  },
  async booked(contact, booking) {
    await prisma.contact.updateMany({ where: { id: contact.id, workspaceId: contact.workspaceId }, data: { email: booking.email.toLowerCase() } });
    await fireContactEvent({ workspaceId: contact.workspaceId, contactId: contact.id, event: "email_captured" });
    // A Calendly link for a time (LINK_SENT) is not a booking yet.
    if (booking.status === "BOOKED") await osEventHooks.onBooking({ workspaceId: contact.workspaceId, contactId: contact.id, bookingId: booking.id });
  },
  async confirm(contact, bookingId, at) {
    const target =
      (bookingId && (await prisma.booking.findFirst({ where: { id: bookingId, contactId: contact.id } }))) ||
      (await prisma.booking.findFirst({ where: { contactId: contact.id, status: { in: ["BOOKED", "LINK_SENT"] } }, orderBy: { createdAt: "desc" } }));
    if (target && target.status !== "CONFIRMED") {
      await prisma.booking.update({ where: { id: target.id }, data: { status: "CONFIRMED", confirmedAt: at } });
    }
    if (target) await prisma.contact.updateMany({ where: { id: contact.id, workspaceId: contact.workspaceId }, data: { email: target.email.toLowerCase() } });
    // Stage through the one stage writer (cause booking): same values as before.
    const { writeStage } = await import("@/lib/os/stage-writer");
    await writeStage({ workspaceId: contact.workspaceId, contactId: contact.id, cause: "booking", change: { type: "stage", stage: "CALL_BOOKED", setterStage: "booked" }, at });
    await fireContactEvent({ workspaceId: contact.workspaceId, contactId: contact.id, event: "stage_changed" });
    if (target) await osEventHooks.onBooking({ workspaceId: contact.workspaceId, contactId: contact.id, bookingId: target.id, at });
  },
  async latest(workspaceId, contactId) {
    const b = await prisma.booking.findFirst({
      where: { workspaceId, contactId, status: { not: "CANCELLED" } },
      orderBy: { createdAt: "desc" },
    });
    return b ? view(b) : null;
  },
};

// ---------------------------------------------------------------- OS_MOCK
/** A sample booking, plus what the follow-up engine tracks on it. */
export type MockBooking = BookingRecord & {
  draftId: string;
  createdAt?: string;
  attendance?: "SHOWED" | "NO_SHOW" | null;
  attendanceSource?: string | null;
  attendanceAt?: string | null;
  cancelledAt?: string | null;
};

const mem = ((globalThis as { __osMockBookings?: Map<string, MockBooking> }).__osMockBookings ??= new Map());

/** OS_MOCK: the in-memory bookings (lib/os/sequences reads and marks them). */
export function mockBookingRows(): Map<string, MockBooking> {
  return mem;
}

const mockBookings: BookingStore = {
  async byDraft(draftId) {
    return [...mem.values()].find((b) => b.draftId === draftId) ?? null;
  },
  async create(input) {
    const b = { ...input, id: `mock-booking-${mem.size + 1}`, confirmedAt: null, createdAt: new Date().toISOString() };
    mem.set(b.id, b);
    return b;
  },
  async booked(contact, booking) {
    updateMockContactExtras(contact.id, { email: booking.email.toLowerCase() });
  },
  async confirm(contact, bookingId, at) {
    const b = (bookingId && mem.get(bookingId)) || [...mem.values()].reverse().find((x) => x.contactId === contact.id && x.status !== "CANCELLED");
    if (b) Object.assign(b, { status: "CONFIRMED", confirmedAt: at.toISOString() });
    updateMockContact(contact.id, { stage: "CALL_BOOKED", setterStage: "booked" });
  },
  async latest(_workspaceId, contactId) {
    return [...mem.values()].reverse().find((b) => b.contactId === contactId && b.status !== "CANCELLED") ?? null;
  },
};

export function bookingStore(): BookingStore {
  return osMockEnabled() ? mockBookings : dbBookings;
}

/** The latest live booking per contact, for the Contacts screen. */
export async function latestBookings(workspaceId: string, contactIds: string[]): Promise<Map<string, BookingRecord>> {
  const out = new Map<string, BookingRecord>();
  if (osMockEnabled()) {
    for (const id of contactIds) {
      const b = await mockBookings.latest(workspaceId, id);
      if (b) out.set(id, b);
    }
    return out;
  }
  if (!contactIds.length) return out;
  const rows = await prisma.booking.findMany({
    where: { workspaceId, contactId: { in: contactIds }, status: { not: "CANCELLED" } },
    orderBy: { createdAt: "desc" },
  });
  for (const r of rows) if (!out.has(r.contactId)) out.set(r.contactId, view(r));
  return out;
}
