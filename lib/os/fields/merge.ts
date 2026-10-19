// Field sync rules (spec §5), pure: how a written value is stored, whether it
// can go to a CRM, and whether it beats the value already there.
import { cleanFieldValue, type CustomFieldType } from "@/lib/os/fields/types";

/** Who wrote a value. Kevin's is stored as "user" (the legacy lock label). */
export type WriteSource = "system" | "step" | "j" | "kevin" | "booking";

export const WRITE_SOURCES: WriteSource[] = ["system", "step", "j", "kevin", "booking"];

/** ContactFieldValue.source for a writer. */
export function storedSource(source: WriteSource): string {
  return source === "kevin" ? "user" : source;
}

/** Kevin's value: nothing else overwrites it. */
export function isLocked(storedSrc: string | null | undefined): boolean {
  return storedSrc === "user" || storedSrc === "kevin";
}

const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, grand: 1e3, m: 1e6, mil: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };

/**
 * A number from how people say it: "about 5k a month" → 5000, "$10,000" →
 * 10000, "1.5m" → 1500000. Null when there's no number or more than one
 * ("4-5k", "between 3 and 5k"): a guess would be worse than not pushing.
 */
export function parseNumberish(raw: string): number | null {
  const s = raw.toLowerCase().replace(/(\d),(?=\d{3}\b)/g, "$1");
  const hits = [...s.matchAll(/(-?\d+(?:\.\d+)?)\s*(thousand|million|billion|grand|mil|bn|k|m|b)?(?![a-z])/g)];
  if (hits.length !== 1) return null;
  const n = Number(hits[0][1]) * (hits[0][2] ? SCALE[hits[0][2]] : 1);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export interface FieldShape {
  type: CustomFieldType;
  options: string[];
}

export type Coerced = { value: string | null; raw: string | null; pushable: boolean } | { error: string };

/**
 * A written value as stored. A value that fits the type is stored clean (a
 * number as "5000", with what was said kept as raw). One that doesn't is
 * stored as said and not pushed, except for Kevin, who gets the error to fix.
 */
export function coerceFieldValue(field: FieldShape, raw: unknown, opts: { strict?: boolean } = {}): Coerced {
  const strict = cleanFieldValue(field.type, raw, field.options);
  if (!("error" in strict)) return { value: strict.value, raw: null, pushable: true };
  const said = (typeof raw === "boolean" ? (raw ? "yes" : "no") : String(raw)).trim().slice(0, 500);
  if (field.type === "NUMBER") {
    const n = parseNumberish(said);
    if (n != null) return { value: String(n), raw: said, pushable: true };
  }
  if (opts.strict) return strict;
  return { value: said, raw: null, pushable: false };
}

/** Can this stored value go to a CRM? (The amber "not pushed" dot when not.) */
export function isPushable(field: FieldShape, value: string | null | undefined): boolean {
  if (value == null || !value.trim()) return false;
  return !("error" in cleanFieldValue(field.type, value, field.options));
}

export interface CurrentValue {
  value: string;
  /** Stored source (Kevin = "user"). */
  source: string;
  at: Date;
}

export type MergeReason = "locked" | "empty" | "stale" | "same";

/**
 * The overwrite rules: Kevin's value is locked against every other writer;
 * otherwise the newest non-empty value wins; an empty value never wipes a
 * filled one (only Kevin can clear a field).
 */
export function decideWrite(
  prev: CurrentValue | null,
  next: { value: string | null; source: WriteSource; at: Date }
): { apply: true } | { apply: false; reason: MergeReason } {
  if (next.source === "kevin") {
    if (prev && isLocked(prev.source) && prev.value === next.value) return { apply: false, reason: "same" };
    if (!prev && next.value == null) return { apply: false, reason: "empty" };
    return { apply: true };
  }
  if (prev && isLocked(prev.source)) return { apply: false, reason: "locked" };
  if (next.value == null || !next.value.trim()) return { apply: false, reason: "empty" };
  if (prev && next.at.getTime() < prev.at.getTime()) return { apply: false, reason: "stale" };
  if (prev && prev.value === next.value) return { apply: false, reason: "same" };
  return { apply: true };
}

/** A history row as Details shows it on hover. */
export interface FieldHistoryItem {
  value: string | null;
  raw: string | null;
  source: string;
  at: string;
  applied: boolean;
  reason: string | null;
}

const SOURCE_LABEL: Record<string, string> = {
  j: "J",
  kevin: "You",
  user: "You",
  step: "Workflow",
  system: "System",
  booking: "Booking",
  import: "Import",
};

/** "J · 12 Oct · 5000 from 'about 5k a month'" (newest first, one per line). */
export function historyTitle(items: FieldHistoryItem[], setterName = "J"): string {
  return items
    .map((h) => {
      const who = h.source === "j" ? setterName : (SOURCE_LABEL[h.source] ?? h.source);
      const day = new Date(h.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      const what = h.value == null ? "cleared" : h.raw ? `${h.value} from '${h.raw}'` : h.value;
      const kept = h.applied ? "" : h.reason === "locked" ? " (kept yours)" : h.reason === "stale" ? " (older)" : "";
      return `${who} · ${day} · ${what}${kept}`;
    })
    .join("\n");
}
