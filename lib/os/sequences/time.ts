// Wall-clock times in a timezone, for "the day before at 17:00 their time".
// Pure; DST-safe to the minute (the offset is re-checked at the result).
import { dayKey, zonedParts } from "@/lib/os/integrations/calendar/slots";

/** Minutes the timezone is ahead of UTC at that instant. */
export function tzOffsetMinutes(at: Date, tz: string): number {
  const p = zonedParts(at, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/** The UTC instant of "YYYY-MM-DD HH:MM" on the wall clock in `tz`. A time
 *  that doesn't exist (the DST jump) lands just after the jump. */
export function zonedTimeToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wall - tzOffsetMinutes(new Date(wall), tz) * 60_000;
  // Second pass: the offset at the guess can differ across a DST change.
  const second = wall - tzOffsetMinutes(new Date(guess), tz) * 60_000;
  if (second !== guess) guess = second;
  return new Date(guess);
}

/** "YYYY-MM-DD" n days after `date` (calendar days, no timezone). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The call's date on the lead's calendar. */
export function localDate(at: Date, tz: string): string {
  return dayKey(at, tz);
}

/** A timezone we can use, else the fallback. */
export function safeTz(tz: string | null | undefined, fallback = "UTC"): string {
  if (!tz) return fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return fallback;
  }
}
