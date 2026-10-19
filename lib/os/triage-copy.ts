// The reason line Jev triage stores, and how the Inbox reads it back. Jev has
// no free text, so the stored line is self-describing ("Jev 0.86 · sales ·
// mentions pricing") and the UI shows the percentage from suggestedConfidence
// plus only the hint. Pure: safe in client components.

/** What "Sort with J" says when triage is disabled (production without Jev). */
export const TRIAGE_DISABLED_NOTICE = "Connect Jev (OPENROUTER_API_KEY) to let J sort";

export type Lean = "sales" | "personal";

export function jevReason(probability: number, lean: Lean, opts: { unsure?: boolean; hint?: string | null } = {}): string {
  const head = `Jev ${probability.toFixed(2)} · ${opts.unsure ? "leans " : ""}${lean}`;
  return opts.hint ? `${head} · ${opts.hint}` : head;
}

const JEV_REASON = /^Jev \d(?:\.\d+)? · (leans )?(sales|personal)(?: · (.+))?$/;

export function parseJevReason(reason: string | null | undefined): { lean: Lean; unsure: boolean; hint: string | null } | null {
  const m = reason ? JEV_REASON.exec(reason) : null;
  return m ? { lean: m[2] as Lean, unsure: Boolean(m[1]), hint: m[3] ?? null } : null;
}

export const percent = (p: number) => `${Math.round(p * 100)}%`;

/** What the triage line says: the label, a quiet percentage (Jev only) and
 *  the hint. `suggested` null with a confidence = J isn't sure. */
export function triageCopy(input: {
  flag: boolean;
  suggested: "SALES" | "PERSONAL" | "PITCHES" | null;
  confidence: number | null;
  reason: string | null;
}): { label: string; pct: string | null; detail: string | null } {
  const parsed = parseJevReason(input.reason);
  const pct = input.confidence != null ? percent(input.confidence) : null;
  if (!input.suggested) {
    const leans = parsed ? `leans ${parsed.lean}` : null;
    return { label: "J isn't sure", pct: null, detail: [leans && pct ? `${leans} ${pct}` : leans, parsed?.hint].filter(Boolean).join(" · ") || null };
  }
  if (input.suggested === "PITCHES") return { label: "Looks like a pitch", pct, detail: (input.reason ?? "").replace(/^Pitch · /, "") || null };
  const label = input.flag ? "Move to Sales?" : `Looks like ${input.suggested === "SALES" ? "sales" : "personal"}`;
  return { label, pct, detail: parsed ? parsed.hint : input.reason };
}

/** Jev looked at an Unsorted contact but was below the floor: "J isn't sure". */
export function isUnsure(c: { kind: string; suggestedKind: string | null; suggestedConfidence: number | null } | null | undefined): boolean {
  return Boolean(c && c.kind === "UNSORTED" && !c.suggestedKind && c.suggestedConfidence != null);
}
