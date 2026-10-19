// A/B tests for openers and J's stage lines.
//
// A slot says where a variant's text goes:
//   campaign_opener:<automationId>  OpenReply's opening DM for that campaign
//   j_opener:<entry>                J's first reply; entry is how they
//                                   arrived (rec.entry.via) or "any"
//   line:<key>                      one of J's stage lines (LINE_KEYS)
// Any slot may end in ":workflow:<id>": the test then runs only inside that
// workflow, and beats a setter-wide test on the same line.

export type SlotKind = "campaign_opener" | "j_opener" | "line";

export const LINE_KEYS = [
  {
    key: "permission_ask",
    label: "Permission ask",
    brief: "you ask permission before a personal question or before sharing something (Stage 3)",
  },
  {
    key: "qualifying",
    label: "Qualifying questions",
    brief: "you ask about their goal, what's in the way, or what they've tried (Stage 4)",
  },
  {
    // The key predates the name: it was "Value offer".
    key: "value_offer",
    label: "Release message",
    brief: "you send them the resource (the lead magnet) they asked for",
  },
  {
    key: "invite",
    label: "Call offer",
    brief: "you invite them to the call (Stage 5)",
  },
  {
    key: "follow_up_1",
    label: "Nudge",
    brief: "this draft is the first nudge after they went quiet",
  },
] as const;

export type LineKey = (typeof LINE_KEYS)[number]["key"];

/** How someone arrives, for j_opener slots (rec.entry.via values). */
export const ENTRY_PATHS = [
  { key: "any", label: "Any entry" },
  { key: "post_keyword", label: "Post keyword" },
  { key: "setter_comment", label: "Setter comment" },
  { key: "setter_keyword", label: "Setter keyword DM" },
  { key: "dm_keyword", label: "DM keyword" },
  { key: "story_keyword", label: "Story reply" },
  { key: "cold_dm", label: "Cold DM (they wrote first)" },
] as const;

export interface ParsedSlot {
  kind: SlotKind;
  /** automationId, entry path or line key. */
  ref: string;
  /** Only inside this workflow; absent = setter-wide. */
  workflowId?: string;
}

const WORKFLOW = ":workflow:";

export function parseSlot(slot: string): ParsedSlot | null {
  const w = slot.indexOf(WORKFLOW);
  const base = w === -1 ? slot : slot.slice(0, w);
  const workflowId = w === -1 ? "" : slot.slice(w + WORKFLOW.length).trim();
  if (w !== -1 && !workflowId) return null;
  const i = base.indexOf(":");
  if (i < 1) return null;
  const kind = base.slice(0, i);
  const ref = base.slice(i + 1).trim();
  if (!ref) return null;
  const out = (k: SlotKind): ParsedSlot => (workflowId ? { kind: k, ref, workflowId } : { kind: k, ref });
  if (kind === "campaign_opener" || kind === "j_opener") return out(kind);
  if (kind === "line" && LINE_KEYS.some((l) => l.key === ref)) return out(kind);
  return null;
}

export const slotOf = (kind: SlotKind, ref: string, workflowId?: string | null) => `${kind}:${ref}${workflowId ? `${WORKFLOW}${workflowId}` : ""}`;

/** The slot without its workflow scope. */
export function baseSlot(slot: string): string {
  const w = slot.indexOf(WORKFLOW);
  return w === -1 ? slot : slot.slice(0, w);
}

/** The slot scoped to a workflow (or unchanged when there is none). */
export const scopedSlot = (base: string, workflowId?: string | null) => (workflowId ? `${baseSlot(base)}${WORKFLOW}${workflowId}` : baseSlot(base));

// ---------------------------------------------------------------- stage lines
/** The six lines a Tests tab lists, mapped onto their slots. */
export const STAGE_LINES = [
  { key: "first_reply", label: "First reply", slot: "j_opener:any" },
  { key: "permission_ask", label: "Permission ask", slot: "line:permission_ask" },
  { key: "qualifying", label: "Qualifying questions", slot: "line:qualifying" },
  { key: "call_offer", label: "Call offer", slot: "line:invite" },
  { key: "release", label: "Release message", slot: "line:value_offer" },
  { key: "nudge", label: "Nudge", slot: "line:follow_up_1" },
] as const;

export type StageLineKey = (typeof STAGE_LINES)[number]["key"];

/** Which stage line a slot belongs to (any J opener entry is the first reply). */
export function stageLineOf(slot: string): (typeof STAGE_LINES)[number] | null {
  const p = parseSlot(slot);
  if (!p || p.kind === "campaign_opener") return null;
  if (p.kind === "j_opener") return STAGE_LINES[0];
  return STAGE_LINES.find((l) => l.slot === `line:${p.ref}`) ?? null;
}

/** What a draft records for each A/B line it carries (Draft.abVariants). */
export interface AbTag {
  experimentId: string;
  variantId: string;
  slot: string;
  /** J reported using it, or the text matched; false = offered, not used. */
  used: boolean;
}

export function readAbTags(v: unknown): AbTag[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (t): t is AbTag =>
      Boolean(t) && typeof t === "object" && typeof (t as AbTag).experimentId === "string" && typeof (t as AbTag).variantId === "string"
  );
}

/** DRAFT = written, never started (no one gets it). */
export type ExperimentStatusName = "DRAFT" | "RUNNING" | "PAUSED" | "FINISHED";
export type AllocationName = "EVEN" | "WEIGHTED";

export interface VariantLite {
  id: string;
  label: string;
  text: string;
  weight: number;
  active: boolean;
}

export interface ExperimentLite {
  id: string;
  workspaceId: string;
  setterId: string | null;
  name: string;
  slot: string;
  status: ExperimentStatusName;
  allocation: AllocationName;
  variants: VariantLite[];
}
