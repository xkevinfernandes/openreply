// A/B tests for openers and key lines (DM OS spec, wave 2 item 2).
//
// A slot says where a variant's text goes:
//   campaign_opener:<automationId>  OpenReply's opening DM for that campaign
//   j_opener:<entry>                J's first message; entry is how they
//                                   arrived (rec.entry.via) or "any"
//   line:<key>                      one of J's key lines (LINE_KEYS)

export type SlotKind = "campaign_opener" | "j_opener" | "line";

export const LINE_KEYS = [
  {
    key: "permission_ask",
    label: "Permission ask",
    brief: "you ask permission before a personal question or before sharing something (Stage 3)",
  },
  {
    key: "value_offer",
    label: "Value offer",
    brief: "you offer them a resource, video or walkthrough",
  },
  {
    key: "invite",
    label: "Invite",
    brief: "you invite them to the call (Stage 5)",
  },
  {
    key: "follow_up_1",
    label: "Follow-up 1",
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
}

export function parseSlot(slot: string): ParsedSlot | null {
  const i = slot.indexOf(":");
  if (i < 1) return null;
  const kind = slot.slice(0, i);
  const ref = slot.slice(i + 1).trim();
  if (!ref) return null;
  if (kind === "campaign_opener" || kind === "j_opener") return { kind, ref };
  if (kind === "line" && LINE_KEYS.some((l) => l.key === ref)) return { kind, ref };
  return null;
}

export const slotOf = (kind: SlotKind, ref: string) => `${kind}:${ref}`;

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

export type ExperimentStatusName = "RUNNING" | "PAUSED" | "FINISHED";
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
