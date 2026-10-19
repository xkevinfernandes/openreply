// Sandbox v2 (Knowledge bases › Test): the situation Kevin picks, the test
// lines he forces, and the "Really book" guard. Pure, so the server action
// and the tests share it. Nothing here counts or syncs anything.

import type { ExperimentLite } from "@/lib/os/experiments/types";
import type { OfferedLine } from "@/lib/os/experiments";
import type { FieldValueView, StepOverride } from "@/lib/os/setter/agent/context";

// ---------------------------------------------------------------- test lines
export type Force = "A" | "B" | "random";

export interface TestLine {
  experimentId: string;
  slot: string;
  /** What J reports in lines_used: "permission_ask". */
  key: string;
  name: string;
  variants: { id: string; label: string; text: string }[];
}

/** The running line tests that apply to this setter (read only). Openers and
 *  follow-ups are their own drafts, so only in-conversation lines are offered. */
export function testLinesFrom(exps: Pick<ExperimentLite, "id" | "slot" | "name" | "status" | "setterId" | "variants">[], setterId: string | null): TestLine[] {
  return exps
    .filter((e) => e.status === "RUNNING" && e.slot.startsWith("line:") && (!e.setterId || e.setterId === setterId))
    .map((e) => ({
      experimentId: e.id,
      slot: e.slot,
      key: e.slot.split(":")[1] ?? e.slot,
      name: e.name,
      variants: e.variants.filter((v) => v.active).map((v) => ({ id: v.id, label: v.label, text: v.text })),
    }))
    .filter((l) => l.variants.length > 0 && l.key !== "follow_up_1");
}

/** The one variant per line J gets, as forced: A, B or a random pick. A line
 *  with no pick is random (what a real lead would get). */
export function forceLines(lines: TestLine[], picks: Record<string, Force | undefined>, random: () => number = Math.random): OfferedLine[] {
  return lines.map((l) => {
    const pick = picks[l.experimentId] ?? "random";
    const byLabel = pick === "random" ? null : l.variants.find((v) => v.label.trim().toUpperCase() === pick);
    const v = byLabel ?? l.variants[Math.min(l.variants.length - 1, Math.floor(random() * l.variants.length))];
    return { experimentId: l.experimentId, variantId: v.id, slot: l.slot, key: l.key, text: v.text, forced: false };
  });
}

/** Variant labels by id, for the Inspect drawer ("permission ask · A"). */
export function labelsOf(lines: TestLine[]): Record<string, string> {
  return Object.fromEntries(lines.flatMap((l) => l.variants.map((v) => [v.id, v.label])));
}

// ---------------------------------------------------------------- situation
export type Goal = "book_call" | "start_conversation";
export type LeadMagnet = "hold" | "send_first" | "none";

export interface Situation {
  goal?: Goal;
  leadMagnet?: LeadMagnet;
  /** The held / first-sent resource slug. */
  resource?: string | null;
  /** Fake contact fields ("First name" → "Sam"). */
  fields?: { key: string; value: string }[];
}

/** get_step's override from the picker. Placeholder until workflows exist. */
export function stepOverrideFrom(s: Situation, titles: Map<string, string>): StepOverride {
  const mode = s.leadMagnet ?? "none";
  const slug = mode === "none" ? null : (s.resource ?? null);
  return {
    goal: s.goal ?? "book_call",
    leadMagnet: { mode, resources: slug ? [{ slug, title: titles.get(slug) ?? slug, released: false }] : [] },
  };
}

/** The short STEP block the sandbox adds to the prompt, so the goal and the
 *  hold apply even when J doesn't call get_step. */
export function stepBlock(o: StepOverride): string {
  const goal = o.goal === "start_conversation" ? "start a conversation (no call push)" : "book a call";
  const lm = o.leadMagnet;
  const r = lm?.resources[0];
  const magnet =
    lm?.mode === "hold" && r
      ? `hold "${r.title}" (slug ${r.slug}): don't send it yet; keep the conversation going first`
      : lm?.mode === "send_first" && r
        ? `send "${r.title}" (slug ${r.slug}) first with send_resource, then talk`
        : "none";
  return `STEP: goal: ${goal}. Lead magnet: ${magnet}.`;
}

/** Fake fields as get_contact sees them. Empty keys or values are dropped. */
export function fakeFieldValues(s: Situation): FieldValueView[] {
  return (s.fields ?? [])
    .map((f) => ({ key: f.key.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), label: f.key.trim(), value: f.value.trim(), source: "sandbox" }))
    .filter((f) => f.key && f.value);
}

// ---------------------------------------------------------------- really book
/** The token the UI sends after Kevin confirms "Really book". */
export const REALLY_BOOK_CONFIRM = "book-a-real-test-event";

/** Booking for real needs both the switch and the confirmation. Default: dry. */
export function reallyBookAllowed(o: { reallyBook?: unknown; confirm?: unknown }): boolean {
  return o.reallyBook === true && o.confirm === REALLY_BOOK_CONFIRM;
}

// ---------------------------------------------------------------- columns
export type ColumnTurn = { from: "lead"; text: string } | { from: "setter"; runs: { reply: { bubbles: string[] } }[]; pick: number };

/** A column's transcript for the server: lead turns, then the picked run's
 *  bubbles (a held turn adds nothing). */
type Said = { from: "lead" | "setter"; text: string };

export function historyOf(turns: ColumnTurn[]): Said[] {
  return turns.flatMap((t): Said[] => (t.from === "lead" ? [{ from: "lead" as const, text: t.text }] : (t.runs[t.pick]?.reply.bubbles ?? []).map((b) => ({ from: "setter" as const, text: b }))));
}
