// Picking a variant. Pure: the store passes in a random number so tests are
// deterministic, and stickiness (a contact keeps its variant) is the store's
// unique key plus `keepOrPick` below.

import type { AllocationName, VariantLite } from "@/lib/os/experiments/types";

/** The variants new contacts can get, with the weight each gets. */
export function eligible(variants: VariantLite[], allocation: AllocationName): { v: VariantLite; w: number }[] {
  return variants
    .filter((v) => v.active && v.text.trim())
    .map((v) => ({ v, w: allocation === "WEIGHTED" ? Math.max(0, Math.floor(v.weight)) : 1 }))
    .filter((x) => x.w > 0);
}

/** Weighted pick with `r` in [0, 1). Null when nothing is eligible. */
export function pickVariant(variants: VariantLite[], allocation: AllocationName, r: number): VariantLite | null {
  const pool = eligible(variants, allocation);
  const total = pool.reduce((s, x) => s + x.w, 0);
  if (!total) return null;
  let target = Math.min(Math.max(r, 0), 0.999999999) * total;
  for (const x of pool) {
    if (target < x.w) return x.v;
    target -= x.w;
  }
  return pool[pool.length - 1].v;
}

/** A contact keeps its variant, even once it's paused or lost to a winner:
 *  someone who got A never suddenly gets B's line. */
export function keepOrPick(
  existingVariantId: string | null | undefined,
  variants: VariantLite[],
  allocation: AllocationName,
  r: number
): { variant: VariantLite | null; isNew: boolean } {
  if (existingVariantId) {
    const kept = variants.find((v) => v.id === existingVariantId);
    if (kept) return { variant: kept, isNew: false };
  }
  return { variant: pickVariant(variants, allocation, r), isNew: true };
}

/** Fill {username} / {first_name} the way OpenReply renders its own copy. */
export function fillName(text: string, name: string | null | undefined): string {
  const n = (name ?? "").trim();
  const first = n.split(/\s+/)[0] ?? "";
  return text
    .replace(/\{username\}/gi, n || "there")
    .replace(/\{first_name\}/gi, first || "there")
    .replace(/\s{2,}/g, " ")
    .trim();
}
