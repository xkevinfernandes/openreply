// The stage view the Kanban, Home pipeline and contact panel pill show: the
// setter's funnel stages, then Booked, Showed, No-show, Won, Lost (plan
// "Defaults" 1). ContactStage stays the source of truth for CRM sync; a
// funnel column only reads/writes J's stage hint (Contact.setterStage). Pure.

import type { ContactStage } from "@/app/generated/prisma/enums";

export interface FunnelStageLike {
  key: string;
  label: string;
}

export type OutcomeKey = "booked" | "showed" | "no_show" | "won" | "lost";

export interface FunnelColumn {
  key: string;
  label: string;
  /** "funnel" = the setter's stages (J's hint), "outcome" = from ContactStage/attendance. */
  group: "funnel" | "outcome";
}

/** J's default stages when a setter has no funnel (the board's Open → Book). */
export const DEFAULT_FUNNEL: FunnelStageLike[] = [
  { key: "open", label: "Open" },
  { key: "value", label: "Value" },
  { key: "permission", label: "Permission" },
  { key: "qualify", label: "Qualify" },
  { key: "assure", label: "Assure" },
  { key: "book", label: "Book" },
];

export const OUTCOME_COLUMNS: FunnelColumn[] = [
  { key: "booked", label: "Booked", group: "outcome" },
  { key: "showed", label: "Showed", group: "outcome" },
  { key: "no_show", label: "No-show", group: "outcome" },
  { key: "won", label: "Won", group: "outcome" },
  { key: "lost", label: "Lost", group: "outcome" },
];

const OUTCOME_KEYS = new Set(OUTCOME_COLUMNS.map((c) => c.key));
/** Funnel entries that are really the Booked outcome. */
const BOOKED_ALIASES = new Set(["booked", "call_booked", "booking_confirmed"]);

/** J's state-machine stage names (prompt.ts stage_proposed) → funnel words. */
const ALIASES: Record<string, string[]> = {
  opener: ["open", "opener", "opening"],
  open: ["open", "opener", "opening"],
  value: ["value"],
  permission: ["permission"],
  qualify: ["qualify", "qualifying", "qualification"],
  bridge: ["assure", "bridge", "invitation", "invite", "book"],
  assure: ["assure", "bridge"],
  invite: ["invitation", "invite", "book", "bridge"],
  invitation: ["invitation", "invite", "book", "bridge"],
  book: ["book", "invitation", "invite", "bridge"],
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

/** A setter's columns: its funnel (Booked-like stages dropped), then the outcomes. */
export function funnelColumns(funnel: FunnelStageLike[] | null | undefined): FunnelColumn[] {
  const stages = (funnel?.length ? funnel : DEFAULT_FUNNEL)
    .map((s) => ({ key: slug(s.key || s.label), label: s.label || s.key }))
    .filter((s) => s.key && !BOOKED_ALIASES.has(s.key) && !OUTCOME_KEYS.has(s.key));
  const seen = new Set<string>();
  const unique = stages.filter((s) => (seen.has(s.key) ? false : (seen.add(s.key), true)));
  return [...unique.map((s) => ({ ...s, group: "funnel" as const })), ...OUTCOME_COLUMNS];
}

/** Which funnel column J's stage hint lands in; null when it names none. */
export function funnelKeyFor(setterStage: string | null | undefined, columns: FunnelColumn[]): string | null {
  if (!setterStage) return null;
  const funnel = columns.filter((c) => c.group === "funnel");
  const s = slug(setterStage);
  const direct = funnel.find((c) => c.key === s || slug(c.label) === s);
  if (direct) return direct.key;
  for (const alias of ALIASES[s] ?? []) {
    const hit = funnel.find((c) => c.key === alias || slug(c.label) === alias);
    if (hit) return hit.key;
  }
  return null;
}

export interface StageInput {
  stage: ContactStage;
  setterStage?: string | null;
  /** Latest call's attendance. */
  attendance?: "SHOWED" | "NO_SHOW" | null;
}

/** The column one contact sits in. */
export function columnFor(c: StageInput, columns: FunnelColumn[]): string {
  if (c.stage === "LOST" || c.stage === "NOT_QUALIFIED") return "lost";
  if (c.stage === "WON") return "won";
  if (c.stage === "SHOWED" || c.attendance === "SHOWED") return "showed";
  if (c.attendance === "NO_SHOW") return "no_show";
  if (c.stage === "CALL_BOOKED") return "booked";
  const hint = slug(c.setterStage ?? "");
  if (BOOKED_ALIASES.has(hint)) return "booked";
  const key = funnelKeyFor(c.setterStage, columns);
  if (key) return key;
  // No hint yet: early ContactStages map onto the funnel's order.
  const funnel = columns.filter((x) => x.group === "funnel");
  if (!funnel.length) return "booked";
  if (c.stage === "CALL_OFFERED") return funnel[funnel.length - 1].key;
  if (c.stage === "QUALIFIED") return funnelKeyFor("qualify", columns) ?? funnel[0].key;
  return funnel[0].key;
}

export type ColumnDrop =
  | { setterStage: string }
  | { stage: ContactStage }
  | { error: string };

/** Dragging a card into a column: a funnel column sets J's stage hint, an
 *  outcome column sets ContactStage. No-show comes from the call, not a drag. */
export function dropOnColumn(columnKey: string, columns: FunnelColumn[]): ColumnDrop {
  const col = columns.find((c) => c.key === columnKey);
  if (!col) return { error: "Unknown column." };
  if (col.group === "funnel") return { setterStage: col.key };
  switch (col.key as OutcomeKey) {
    case "booked":
      return { stage: "CALL_BOOKED" };
    case "showed":
      return { stage: "SHOWED" };
    case "won":
      return { stage: "WON" };
    case "lost":
      return { stage: "LOST" };
    default:
      return { error: "Mark a no-show on the call instead." };
  }
}

/** Count contacts per column, in column order (Home pipeline). */
export function countByColumn(contacts: StageInput[], columns: FunnelColumn[]): { key: string; label: string; count: number }[] {
  const counts = new Map(columns.map((c) => [c.key, 0]));
  for (const c of contacts) {
    const k = columnFor(c, columns);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return columns.map((c) => ({ key: c.key, label: c.label, count: counts.get(c.key) ?? 0 }));
}
