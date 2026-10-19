// Checking the create form (pure, so it's tested without a DB).

import { parseSlot, type AllocationName } from "@/lib/os/experiments/types";

export interface ExperimentInput {
  name: string;
  slot: string;
  setterId: string | null;
  allocation: AllocationName;
  minSends: number;
  variants: { label?: string; text: string; weight?: number; style?: string | null }[];
}

export const MAX_VARIANTS = 6;

export function cleanInput(raw: ExperimentInput, busySlots: string[]): { error: string } | { value: ExperimentInput & { variants: { label: string; text: string; weight: number; style: string | null }[] } } {
  const name = String(raw.name ?? "").trim().slice(0, 120);
  if (!name) return { error: "Give the test a name." };
  const slot = String(raw.slot ?? "").trim();
  if (!parseSlot(slot)) return { error: "Pick where the line goes." };
  if (busySlots.includes(slot)) return { error: "A test is already running there. Pause or finish it first." };
  const allocation: AllocationName = raw.allocation === "WEIGHTED" ? "WEIGHTED" : "EVEN";
  const minSends = Math.round(Number(raw.minSends));
  if (!Number.isFinite(minSends) || minSends < 10 || minSends > 5000) return { error: "Sends before judging must be between 10 and 5000." };
  const variants = (Array.isArray(raw.variants) ? raw.variants : [])
    .map((v) => ({ text: String(v.text ?? "").trim(), weight: Math.round(Number(v.weight ?? 1)), style: v.style ? String(v.style).slice(0, 40) : null }))
    .filter((v) => v.text);
  if (variants.length < 2) return { error: "Write at least two variants." };
  if (variants.length > MAX_VARIANTS) return { error: `Up to ${MAX_VARIANTS} variants.` };
  if (variants.some((v) => v.text.length > 1000)) return { error: "Keep each variant under 1000 characters." };
  if (new Set(variants.map((v) => v.text.toLowerCase())).size !== variants.length) return { error: "Two variants say the same thing." };
  if (allocation === "WEIGHTED" && variants.some((v) => !Number.isFinite(v.weight) || v.weight < 1 || v.weight > 100))
    return { error: "Weights go from 1 to 100." };
  return {
    value: {
      name,
      slot,
      setterId: parseSlot(slot)!.kind === "campaign_opener" ? null : raw.setterId || null,
      allocation,
      minSends,
      variants: variants.map((v, i) => ({ label: String.fromCharCode(65 + i), text: v.text, weight: allocation === "WEIGHTED" ? v.weight : 1, style: v.style })),
    },
  };
}
