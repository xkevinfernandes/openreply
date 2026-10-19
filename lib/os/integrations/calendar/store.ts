// DB side of the calendars: the encrypted token, the settings, and which
// calendar J books on. One calendar books at a time: switching one on
// switches the other off (app/(os)/os/integrations/calendar-actions.ts).
import { bookingOf, calendarForSetter } from "@/lib/os/integrations/calendar/setter-booking";
import { prisma } from "@/lib/db/client";
import { decryptToken, encryptToken } from "@/lib/meta/oauth";
import { osMockEnabled } from "@/lib/os/mock";
import { createCalcom } from "./calcom";
import { createCalendly } from "./calendly";
import { createMockCalendar, MOCK_EVENT_TYPE } from "./mock";
import { DEFAULT_SETTER_KEY, defaultCalendarSettings, eventTypeFor, normalizeCalendarSettings, type CalendarSettings } from "./settings";
import type { CalendarProvider, CalendarProviderId, CalendarSourceId } from "./types";

export interface ActiveCalendar {
  provider: CalendarSourceId;
  client: CalendarProvider;
  settings: CalendarSettings;
  /** Null when no event type is picked for this setter (J then can't book). */
  eventTypeId: string | null;
  eventName: string | null;
  durationMinutes: number | null;
  /** Setup › Booking: the link J falls back to when no offered time fits. */
  fallbackLink?: string | null;
  fallbackAfterHours?: number;
}

export function encryptCalendarToken(token: string): string {
  return encryptToken(JSON.stringify({ token }));
}

function tokenOf(credentials: string | null): string | null {
  if (!credentials) return null;
  try {
    return (JSON.parse(decryptToken(credentials)) as { token?: string }).token ?? null;
  } catch {
    return null;
  }
}

export function calendarClient(provider: CalendarProviderId, token: string): CalendarProvider {
  return provider === "calcom" ? createCalcom(token) : createCalendly(token);
}

/** OS_MOCK: the sample calendar's settings, editable in memory. */
const mockSettings = ((globalThis as { __osMockCalSettings?: CalendarSettings }).__osMockCalSettings ??= {
  ...defaultCalendarSettings(),
  hostTimezone: "Europe/Lisbon",
  minNoticeHours: 2,
  eventTypes: { [DEFAULT_SETTER_KEY]: MOCK_EVENT_TYPE.id },
  eventTypeInfo: { [MOCK_EVENT_TYPE.id]: { name: MOCK_EVENT_TYPE.name, durationMinutes: MOCK_EVENT_TYPE.durationMinutes } },
  accountName: "Sample calendar",
});

function active(provider: CalendarSourceId, client: CalendarProvider, settings: CalendarSettings, setterId: string | null): ActiveCalendar {
  const eventTypeId = eventTypeFor(settings, setterId);
  const info = eventTypeId ? settings.eventTypeInfo[eventTypeId] : undefined;
  return { provider, client, settings, eventTypeId, eventName: info?.name ?? null, durationMinutes: info?.durationMinutes ?? null };
}

/** The connected client for one provider, or null. */
export async function loadCalendarProvider(workspaceId: string, provider: CalendarSourceId): Promise<{ client: CalendarProvider; settings: CalendarSettings } | null> {
  if (provider === "mock") return osMockEnabled() ? { client: createMockCalendar({ hostTimezone: mockSettings.hostTimezone }), settings: mockSettings } : null;
  const row = await prisma.osIntegration.findUnique({ where: { workspaceId_provider: { workspaceId, provider } } });
  const token = tokenOf(row?.credentials ?? null);
  if (!row || !token) return null;
  return { client: calendarClient(provider, token), settings: normalizeCalendarSettings(row.settings) };
}

/** The calendar J books on for this setter: connected and switched on. With
 *  OS_MOCK and nothing connected, the sample calendar. */
export async function activeCalendar(workspaceId: string, setterId: string | null): Promise<ActiveCalendar | null> {
  const cal = await connectedCalendar(workspaceId, setterId);
  if (!cal || !setterId) return cal;
  // Setup › Booking: link mode means J never offers times; calendar mode sets
  // how many and how far ahead, and the fallback link.
  const setter = await prisma.setter.findFirst({ where: { id: setterId, workspaceId }, select: { settings: true } }).catch(() => null);
  const booking = bookingOf(setter?.settings);
  const settings = calendarForSetter(cal.settings, booking);
  if (!settings) return null;
  return { ...cal, settings, fallbackLink: booking.link, fallbackAfterHours: booking.fallbackAfterHours };
}

/** The connected calendar before the setter's own rule. */
export async function connectedCalendar(workspaceId: string, setterId: string | null): Promise<ActiveCalendar | null> {
  {
    const rows = await prisma.osIntegration
      .findMany({
        where: { workspaceId, provider: { in: ["calcom", "calendly"] }, enabled: true, credentials: { not: null } },
        orderBy: { updatedAt: "desc" },
      })
      .catch(() => []);
    for (const row of rows) {
      const token = tokenOf(row.credentials);
      if (!token) continue;
      const provider = row.provider as CalendarProviderId;
      return active(provider, calendarClient(provider, token), normalizeCalendarSettings(row.settings), setterId);
    }
  }
  if (osMockEnabled()) return active("mock", createMockCalendar({ hostTimezone: mockSettings.hostTimezone }), mockSettings, setterId);
  return null;
}

/** Calendly refused an API booking (Free plan): from now on J sends a link
 *  for the exact time instead. */
export async function disableDirectBooking(workspaceId: string, provider: CalendarSourceId) {
  if (provider === "mock") {
    mockSettings.directBooking = false;
    return;
  }
  const row = await prisma.osIntegration.findUnique({ where: { workspaceId_provider: { workspaceId, provider } } });
  if (!row) return;
  const settings = { ...normalizeCalendarSettings(row.settings), directBooking: false };
  await prisma.osIntegration.update({ where: { id: row.id }, data: { settings: JSON.parse(JSON.stringify(settings)) } });
}

export function mockCalendarSettings(): CalendarSettings {
  return mockSettings;
}
