// What the Calendar & Scheduling cards show.
import { prisma } from "@/lib/db/client";
import { osMockEnabled } from "@/lib/os/mock";
import { normalizeCalendarSettings, type CalendarSettings } from "./settings";
import { CALENDAR_PROVIDERS, type CalendarProviderId } from "./types";
import { webhookUrl } from "@/lib/os/sequences/calendar-sync";

export interface CalendarView {
  provider: CalendarProviderId;
  connected: boolean;
  /** J books on it. */
  enabled: boolean;
  settings: CalendarSettings;
  lastTestedAt: string | null;
  lastError: string | null;
  booked: number;
  upcoming: number;
  /** Cancels, reschedules and no-shows come in (lib/os/sequences/calendar-sync.ts). */
  webhook: { ready: boolean; url: string };
}

export interface CalendarBoard {
  calendars: CalendarView[];
  setters: { id: string; name: string }[];
  /** OS_MOCK with nothing connected: J books on the sample calendar. */
  sample: boolean;
}

export async function calendarBoard(workspaceId: string): Promise<CalendarBoard> {
  const [rows, setters, counts, upcoming] = await Promise.all([
    prisma.osIntegration.findMany({ where: { workspaceId, provider: { in: CALENDAR_PROVIDERS } } }),
    prisma.setter.findMany({ where: { workspaceId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.booking.groupBy({ by: ["provider"], where: { workspaceId, status: { in: ["BOOKED", "CONFIRMED"] } }, _count: { _all: true } }),
    prisma.booking.groupBy({ by: ["provider"], where: { workspaceId, status: { in: ["BOOKED", "CONFIRMED"] }, start: { gte: new Date() } }, _count: { _all: true } }),
  ]);
  const calendars = CALENDAR_PROVIDERS.map((provider) => {
    const row = rows.find((r) => r.provider === provider);
    return {
      provider,
      connected: Boolean(row?.credentials),
      enabled: Boolean(row?.credentials) && (row?.enabled ?? false),
      settings: normalizeCalendarSettings(row?.settings),
      lastTestedAt: row?.lastTestedAt?.toISOString() ?? null,
      lastError: row?.lastError ?? null,
      booked: counts.find((c) => c.provider === provider)?._count._all ?? 0,
      upcoming: upcoming.find((c) => c.provider === provider)?._count._all ?? 0,
      webhook: { ready: Boolean(row?.webhookSecret), url: webhookUrl(workspaceId, provider) },
    };
  });
  return { calendars, setters, sample: osMockEnabled() && !calendars.some((c) => c.enabled) };
}
