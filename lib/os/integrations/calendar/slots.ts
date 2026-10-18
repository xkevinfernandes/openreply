// Which free times J offers and how it says them. Pure: no IO, no clock (now
// is passed in), so it is tested on fixed dates.
import type { CalendarSettings } from "./settings";
import type { CalendarSlot } from "./types";

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  /** 0 = Sunday. */
  weekday: number;
  hour: number;
  minute: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const fmtCache = new Map<string, Intl.DateTimeFormat>();

export function zonedParts(date: Date, tz: string): ZonedParts {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    });
    fmtCache.set(tz, f);
  }
  const parts = Object.fromEntries(f.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: WEEKDAYS.indexOf(String(parts.weekday)),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

/** "2026-10-21" in that timezone. */
export function dayKey(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Canonical slot id: UTC with seconds, "Z". */
export function slotId(start: string | Date): string {
  const d = typeof start === "string" ? new Date(start) : start;
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function clock(p: ZonedParts): string {
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const ampm = p.hour < 12 ? "am" : "pm";
  return p.minute ? `${h12}:${String(p.minute).padStart(2, "0")}${ampm}` : `${h12}${ampm}`;
}

/** "3pm", "11:30am" in that timezone. */
export function formatTime(start: string, tz: string): string {
  return clock(zonedParts(new Date(start), tz));
}

/** "Tuesday 21 Oct, 3pm" in that timezone. */
export function formatSlot(start: string, tz: string): string {
  const p = zonedParts(new Date(start), tz);
  return `${WEEKDAY_LONG[p.weekday]} ${p.day} ${MONTHS[p.month - 1]}, ${clock(p)}`;
}

/** "Tue 21 Oct, 15:00" for the screen (24h, compact). */
export function formatSlotShort(start: string, tz: string): string {
  const p = zonedParts(new Date(start), tz);
  return `${WEEKDAYS[p.weekday]} ${p.day} ${MONTHS[p.month - 1]}, ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** "Lisbon" from "Europe/Lisbon", "New York" from "America/New_York". */
export function tzCity(tz: string): string {
  if (tz === "UTC" || tz === "Etc/UTC") return "UTC";
  return (tz.split("/").pop() ?? tz).replace(/_/g, " ");
}

/**
 * Free times J may offer: inside the working hours (host time), past the
 * minimum notice, within the days-ahead window. The provider has already
 * removed busy times; this narrows them to what Kevin wants for setter calls.
 */
export function filterSlots(slots: CalendarSlot[], s: CalendarSettings, now: Date, durationMinutes: number | null = null): CalendarSlot[] {
  const earliest = now.getTime() + s.minNoticeHours * 3600_000;
  const latest = now.getTime() + s.daysAhead * 86_400_000;
  const seen = new Set<string>();
  const out: CalendarSlot[] = [];
  for (const slot of slots) {
    const start = new Date(slot.start);
    const t = start.getTime();
    if (!Number.isFinite(t) || t < earliest || t > latest) continue;
    const p = zonedParts(start, s.hostTimezone);
    if (!s.workDays.includes(p.weekday)) continue;
    const startMin = p.hour * 60 + p.minute;
    const length = durationMinutes ?? (slot.end ? Math.round((new Date(slot.end).getTime() - t) / 60_000) : 30);
    if (startMin < s.workStart * 60 || startMin + Math.max(0, length) > s.workEnd * 60) continue;
    const id = slotId(start);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ ...slot, start: id });
  }
  return out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

/** Hours that are fine to offer someone in their own timezone. */
const FRIENDLY_START = 8;
const FRIENDLY_END = 20;

/**
 * The few times J offers first. Spread out: the earliest good time, then a
 * different day and (when there is a choice) the other half of the day, so
 * "tuesday 3pm or wednesday 11am" gives a real choice. In the lead's
 * timezone when known, nothing before 8am or after 8pm their time.
 */
export function pickOptions(slots: CalendarSlot[], n: number, leadTz: string | null, exclude: string[] = []): CalendarSlot[] {
  const skip = new Set(exclude.map((e) => slotId(e)));
  let pool = slots.filter((s) => !skip.has(s.start));
  if (leadTz) {
    const friendly = pool.filter((s) => {
      const h = zonedParts(new Date(s.start), leadTz).hour;
      return h >= FRIENDLY_START && h < FRIENDLY_END;
    });
    if (friendly.length) pool = friendly;
  }
  const tz = leadTz ?? "UTC";
  const picked: CalendarSlot[] = [];
  const half = (s: CalendarSlot) => (zonedParts(new Date(s.start), tz).hour < 12 ? "am" : "pm");
  const day = (s: CalendarSlot) => dayKey(new Date(s.start), tz);
  while (picked.length < n && pool.length) {
    const days = new Set(picked.map(day));
    const halves = new Set(picked.map(half));
    const next =
      pool.find((s) => !days.has(day(s)) && !halves.has(half(s))) ??
      pool.find((s) => !days.has(day(s))) ??
      pool.find((s) => picked.every((p) => Math.abs(new Date(p.start).getTime() - new Date(s.start).getTime()) >= 2 * 3600_000)) ??
      pool[0];
    picked.push(next);
    pool = pool.filter((s) => s !== next);
  }
  return picked.sort((a, b) => (a.start < b.start ? -1 : 1));
}

// ---------------------------------------------------------------- their timezone
// Cheap: most people say where they are ("I'm in Lisbon", "EST"). The model
// can also return an IANA zone; this only saves a question.
const PLACES: [RegExp, string][] = [
  [/\b(london|uk|england|manchester|birmingham|leeds|liverpool|bristol|edinburgh|glasgow|scotland|wales|gmt|bst)\b/, "Europe/London"],
  [/\b(dublin|ireland|cork)\b/, "Europe/Dublin"],
  [/\b(lisbon|lisboa|portugal|porto|algarve)\b/, "Europe/Lisbon"],
  [/\b(madrid|spain|barcelona|valencia|seville|malaga)\b/, "Europe/Madrid"],
  [/\b(paris|france|lyon|marseille|cet)\b/, "Europe/Paris"],
  [/\b(berlin|germany|munich|hamburg|frankfurt|cologne)\b/, "Europe/Berlin"],
  [/\b(amsterdam|netherlands|rotterdam|holland)\b/, "Europe/Amsterdam"],
  [/\b(brussels|belgium|antwerp)\b/, "Europe/Brussels"],
  [/\b(zurich|geneva|switzerland)\b/, "Europe/Zurich"],
  [/\b(milan|rome|italy|florence|naples)\b/, "Europe/Rome"],
  [/\b(stockholm|sweden)\b/, "Europe/Stockholm"],
  [/\b(oslo|norway)\b/, "Europe/Oslo"],
  [/\b(copenhagen|denmark)\b/, "Europe/Copenhagen"],
  [/\b(helsinki|finland)\b/, "Europe/Helsinki"],
  [/\b(warsaw|poland|krakow)\b/, "Europe/Warsaw"],
  [/\b(prague|czech)\b/, "Europe/Prague"],
  [/\b(vienna|austria)\b/, "Europe/Vienna"],
  [/\b(athens|greece)\b/, "Europe/Athens"],
  [/\b(istanbul|turkey)\b/, "Europe/Istanbul"],
  [/\b(dubai|uae|abu dhabi)\b/, "Asia/Dubai"],
  [/\b(cairo|egypt)\b/, "Africa/Cairo"],
  [/\b(lagos|nigeria)\b/, "Africa/Lagos"],
  [/\b(nairobi|kenya)\b/, "Africa/Nairobi"],
  [/\b(johannesburg|cape town|south africa)\b/, "Africa/Johannesburg"],
  [/\b(mumbai|delhi|bangalore|bengaluru|india|ist)\b/, "Asia/Kolkata"],
  [/\b(singapore)\b/, "Asia/Singapore"],
  [/\b(hong kong)\b/, "Asia/Hong_Kong"],
  [/\b(tokyo|japan)\b/, "Asia/Tokyo"],
  [/\b(seoul|korea)\b/, "Asia/Seoul"],
  [/\b(manila|philippines)\b/, "Asia/Manila"],
  [/\b(bangkok|thailand)\b/, "Asia/Bangkok"],
  [/\b(bali)\b/, "Asia/Makassar"],
  [/\b(jakarta|indonesia)\b/, "Asia/Jakarta"],
  [/\b(sydney|melbourne|canberra|aest)\b/, "Australia/Sydney"],
  [/\b(brisbane)\b/, "Australia/Brisbane"],
  [/\b(perth)\b/, "Australia/Perth"],
  [/\b(auckland|new zealand|nz)\b/, "Pacific/Auckland"],
  [/\b(toronto|ottawa|montreal)\b/, "America/Toronto"],
  [/\b(new york|nyc|boston|miami|atlanta|philadelphia|florida|east coast|eastern time|est|edt)\b/, "America/New_York"],
  [/\b(chicago|texas|dallas|houston|austin|central time|cst|cdt)\b/, "America/Chicago"],
  [/\b(denver|colorado|mountain time|mst|mdt)\b/, "America/Denver"],
  [/\b(phoenix|arizona)\b/, "America/Phoenix"],
  [/\b(vancouver)\b/, "America/Vancouver"],
  [/\b(los angeles|san francisco|san diego|seattle|portland|california|west coast|pacific time|pst|pdt)\b/, "America/Los_Angeles"],
  [/\b(mexico city|mexico)\b/, "America/Mexico_City"],
  [/\b(sao paulo|são paulo|brazil|brasil|rio)\b/, "America/Sao_Paulo"],
  [/\b(buenos aires|argentina)\b/, "America/Argentina/Buenos_Aires"],
  [/\b(bogota|bogotá|colombia|medellin|medellín)\b/, "America/Bogota"],
  [/\b(lima|peru)\b/, "America/Lima"],
  [/\b(santiago|chile)\b/, "America/Santiago"],
];

/** Their timezone from what they wrote, newest message first, or null. */
export function guessTimezone(texts: string[]): string | null {
  for (const raw of [...texts].reverse()) {
    const t = ` ${(raw ?? "").toLowerCase()} `;
    for (const [re, tz] of PLACES) if (re.test(t)) return tz;
  }
  return null;
}

/** One line for a draft card or a header: "Tue 21 Oct, 3pm their time (2pm yours)". */
export function bookingSummary(p: { start: string; timezone: string; hostTimezone: string }): string {
  const theirs = formatSlot(p.start, p.timezone);
  if (p.timezone === p.hostTimezone) return `${theirs} (${tzCity(p.timezone)})`;
  return `${theirs} their time (${formatTime(p.start, p.hostTimezone)} yours)`;
}
