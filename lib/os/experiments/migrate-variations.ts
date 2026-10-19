// The old Funnel "Variations" (rotated in J's prompt, never measured) become
// a DRAFT line test per stage: written, not started. Pure planner for
// scripts/os-migrate-variations.ts, so it's tested without a DB. Idempotent:
// a stage whose texts already sit in a test for that setter and line isn't
// copied again, and migrated text leaves the funnel.

import { STAGE_LINES, type StageLineKey } from "@/lib/os/experiments/types";
import { MAX_LINE_VARIANTS } from "@/lib/os/experiments/validate";

export interface SetterFunnelRow {
  id: string;
  workspaceId: string;
  name: string;
  funnel: unknown;
}

export interface ExistingTest {
  setterId: string | null;
  slot: string;
  texts: string[];
}

export interface PlannedDraft {
  workspaceId: string;
  setterId: string;
  setterName: string;
  stage: string;
  line: StageLineKey;
  slot: string;
  texts: string[];
}

export interface MigrationPlan {
  create: PlannedDraft[];
  /** Already migrated: the funnel only loses the copied text. */
  already: { setterName: string; stage: string; line: StageLineKey }[];
  /** No stage line fits: the text stays in the funnel (not shown, not used). */
  skipped: { setterName: string; stage: string; texts: number }[];
  /** The funnel to save per setter (variations moved out, ab switch gone). */
  funnels: { setterId: string; funnel: Record<string, unknown>[] }[];
}

/** Which stage line a funnel stage's wording belongs to. */
export function lineForStage(key: string, label: string): StageLineKey | null {
  const s = `${key} ${label}`.toLowerCase();
  if (/permission/.test(s)) return "permission_ask";
  if (/qualif/.test(s)) return "qualifying";
  if (/nudge|follow/.test(s)) return "nudge";
  if (/bridge|invite|call|book|pitch|offer/.test(s)) return "call_offer";
  if (/release|resource|lead|magnet|deliver|value/.test(s)) return "release";
  if (/open|first|greet|hello|hi\b/.test(s)) return "first_reply";
  return null;
}

const norm = (t: string) => t.trim().toLowerCase();
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.map(norm).includes(norm(x)));

export function planVariationMigration(setters: SetterFunnelRow[], existing: ExistingTest[]): MigrationPlan {
  const plan: MigrationPlan = { create: [], already: [], skipped: [], funnels: [] };
  for (const setter of setters) {
    const stages = Array.isArray(setter.funnel) ? (setter.funnel as Record<string, unknown>[]) : [];
    let changed = false;
    const next = stages.map((raw) => {
      if (!raw || typeof raw !== "object") return raw;
      const st = { ...raw };
      if ("ab" in st) {
        delete st.ab;
        changed = true;
      }
      const texts = (Array.isArray(st.variations) ? st.variations : []).filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);
      if (!texts.length) {
        if ("variations" in st) {
          delete st.variations;
          changed = true;
        }
        return st;
      }
      const key = String(st.key ?? "");
      const label = String(st.label ?? key);
      const line = lineForStage(key, label);
      if (!line) {
        plan.skipped.push({ setterName: setter.name, stage: label, texts: texts.length });
        return st;
      }
      const slot = STAGE_LINES.find((l) => l.key === line)!.slot;
      const take = texts.slice(0, MAX_LINE_VARIANTS);
      const rest = texts.slice(MAX_LINE_VARIANTS);
      const done = existing.some((e) => e.setterId === setter.id && e.slot === slot && sameSet(e.texts, take));
      if (done) plan.already.push({ setterName: setter.name, stage: label, line });
      else plan.create.push({ workspaceId: setter.workspaceId, setterId: setter.id, setterName: setter.name, stage: label, line, slot, texts: take });
      // More than a test holds: the rest waits for the next run.
      if (rest.length) st.variations = rest;
      else delete st.variations;
      changed = true;
      return st;
    });
    if (changed) plan.funnels.push({ setterId: setter.id, funnel: next });
  }
  return plan;
}
