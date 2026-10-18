// How J uses a connected calendar (OsIntegration.settings). Pure, so the
// Integrations screen can import it.

/** Key in eventTypes for "every setter without its own pick". */
export const DEFAULT_SETTER_KEY = "default";

export interface CalendarSettings {
  /** setterId (or "default") → the event type J books for that setter. */
  eventTypes: Record<string, string>;
  /** eventTypeId → its name and length, cached when picked, for the prompt. */
  eventTypeInfo: Record<string, { name: string; durationMinutes: number | null }>;
  /** The host's IANA timezone (working hours are read in it). */
  hostTimezone: string;
  /** Working hours for setter calls, host time, whole hours: [workStart, workEnd). */
  workStart: number;
  workEnd: number;
  /** 0 = Sunday … 6 = Saturday. */
  workDays: number[];
  /** No call sooner than this many hours from now. */
  minNoticeHours: number;
  /** How far ahead J looks for times. */
  daysAhead: number;
  /** How many times J offers at once. */
  options: number;
  /** Calendly only: false once Calendly refused an API booking (free plan).
   *  J then sends a link for the exact time instead. */
  directBooking: boolean;
  /** Who the key belongs to (from Test). */
  accountName: string | null;
}

export function defaultCalendarSettings(): CalendarSettings {
  return {
    eventTypes: {},
    eventTypeInfo: {},
    hostTimezone: "UTC",
    workStart: 9,
    workEnd: 18,
    workDays: [1, 2, 3, 4, 5],
    minNoticeHours: 12,
    daysAhead: 7,
    options: 2,
    directBooking: true,
    accountName: null,
  };
}

export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz.trim() || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const int = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

const str = (v: unknown, max = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Read the stored JSON defensively. */
export function normalizeCalendarSettings(raw: unknown): CalendarSettings {
  const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const base = defaultCalendarSettings();
  const eventTypes: Record<string, string> = {};
  for (const [k, v] of Object.entries((m.eventTypes && typeof m.eventTypes === "object" ? m.eventTypes : {}) as Record<string, unknown>)) {
    const id = str(v);
    if (id && k.length <= 64) eventTypes[k] = id;
  }
  const eventTypeInfo: CalendarSettings["eventTypeInfo"] = {};
  for (const [k, v] of Object.entries((m.eventTypeInfo && typeof m.eventTypeInfo === "object" ? m.eventTypeInfo : {}) as Record<string, unknown>)) {
    const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    const name = str(o.name, 120);
    if (name) eventTypeInfo[k.slice(0, 300)] = { name, durationMinutes: typeof o.durationMinutes === "number" ? o.durationMinutes : null };
  }
  const workStart = int(m.workStart, 0, 23, base.workStart);
  let workEnd = int(m.workEnd, 1, 24, base.workEnd);
  if (workEnd <= workStart) workEnd = Math.min(24, workStart + 1);
  const days = Array.isArray(m.workDays)
    ? [...new Set(m.workDays.map((d) => int(d, 0, 6, -1)).filter((d) => d >= 0))].sort()
    : base.workDays;
  return {
    eventTypes,
    eventTypeInfo,
    hostTimezone: isTimeZone(m.hostTimezone) ? m.hostTimezone : base.hostTimezone,
    workStart,
    workEnd,
    workDays: days.length ? days : base.workDays,
    minNoticeHours: int(m.minNoticeHours, 0, 168, base.minNoticeHours),
    daysAhead: int(m.daysAhead, 1, 30, base.daysAhead),
    options: int(m.options, 1, 3, base.options),
    directBooking: typeof m.directBooking === "boolean" ? m.directBooking : true,
    accountName: str(m.accountName, 120),
  };
}

/** The event type J books for this setter: its own pick, else the default. */
export function eventTypeFor(settings: CalendarSettings, setterId: string | null | undefined): string | null {
  return (setterId && settings.eventTypes[setterId]) || settings.eventTypes[DEFAULT_SETTER_KEY] || null;
}
