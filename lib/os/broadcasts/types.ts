// Broadcasts: one-off records (dm-crm slice 5). Each broadcast is sent once
// and kept; Follow-up Friday is a new broadcast each week ("Duplicate").

export type BroadcastRunStatus = "drafting" | "review" | "scheduled" | "done";
/** draft_failed: J couldn't write it (Retry). */
export type BroadcastMessageStatus = "drafted" | "approved" | "scheduled" | "sent" | "skipped" | "failed" | "outside_window" | "draft_failed";

export const FOLLOW_UP_FRIDAY = { key: "follow-up-friday", tag: "follow-up-friday", name: "Follow-up Friday" } as const;

/** One-off broadcast status (stored on Broadcast.status). */
export type BroadcastStatus = "draft" | "drafting" | "in_review" | "scheduled" | "sending" | "sent" | "cancelled";
export const BROADCAST_STATUSES: readonly BroadcastStatus[] = ["draft", "drafting", "in_review", "scheduled", "sending", "sent", "cancelled"];
export type BroadcastStartMode = "now" | "window";
export type PersonaliseMode = "per_person" | "variations" | "as_written";
export const PERSONALISE_MODES: readonly PersonaliseMode[] = ["per_person", "variations", "as_written"];
/** How many versions "5 variations" writes. */
export const VARIATION_COUNT = 5;

/** One bubble of a broadcast's message (Broadcast.bubbles). A link bubble with
 *  url null still needs one ("pick a resource or link"). */
export type BroadcastBubble = { type: "text"; text: string } | { type: "link"; url: string | null; resourceId?: string | null; label?: string | null };

/** Why a message was skipped or didn't go (BroadcastMessage.skipReason). */
export type SkipReason =
  | "sent_by_kevin"
  | "cancelled"
  | "left_the_tag"
  | "archived"
  | "spam"
  | "paused"
  | "personal"
  | "pitches"
  | "wrote_since_drafting"
  | "cap"
  | "window_end"
  | "their_window"
  | "failed"
  | "contact_gone";

/** The not-sent groups of a finished broadcast (approved, didn't go). */
export const NOT_SENT_REASONS: readonly SkipReason[] = ["cap", "window_end", "their_window", "wrote_since_drafting", "failed"];

export const SKIP_LABEL: Record<SkipReason, string> = {
  sent_by_kevin: "Sent by you",
  cancelled: "Cancelled",
  left_the_tag: "Left the tag",
  archived: "Archived",
  spam: "Spam",
  paused: "Paused",
  personal: "Personal",
  pitches: "Pitches",
  wrote_since_drafting: "Wrote since drafting",
  cap: "Daily cap",
  window_end: "Window ended",
  their_window: "Their 24-hour window",
  failed: "Failed send",
  contact_gone: "Contact gone",
};

/** Parse Broadcast.bubbles (JSON) defensively. */
export function parseBubbles(v: unknown): BroadcastBubble[] {
  if (!Array.isArray(v)) return [];
  const out: BroadcastBubble[] = [];
  for (const b of v) {
    if (!b || typeof b !== "object") continue;
    const o = b as Record<string, unknown>;
    if (o.type === "text" && typeof o.text === "string") out.push({ type: "text", text: o.text });
    else if (o.type === "link")
      out.push({
        type: "link",
        url: typeof o.url === "string" && o.url ? o.url : null,
        resourceId: typeof o.resourceId === "string" ? o.resourceId : null,
        label: typeof o.label === "string" ? o.label : null,
      });
  }
  return out;
}

/** Parse Broadcast.variations (string[][]) defensively. */
export function parseVariations(v: unknown): string[][] {
  return Array.isArray(v) ? (v as unknown[]).map((x) => (Array.isArray(x) ? x.map(String) : [])) : [];
}

export interface BroadcastView {
  id: string;
  key: string;
  name: string;
  /** The audience tag's current name ("" for a fixed list). */
  audienceTag: string;
  /** Managed tag id (Tag.id); null for a fixed list. */
  audienceTagId: string | null;
  /** Fixed audience ("New broadcast to these N"). */
  contactIds: string[];
  status: BroadcastStatus;
  startMode: BroadcastStartMode;
  /** "YYYY-MM-DD" in timezone (window mode; set at Send for now mode). */
  sendDate: string | null;
  bubbles: BroadcastBubble[];
  personaliseMode: PersonaliseMode;
  /** variations mode: the 5 variations of the text bubbles. */
  variations: string[][];
  duplicatedFromId: string | null;
  followupTemplate: string | null;
  followupDelayMin: number;
  /** "HH:MM". Now mode: windowEnd is the end time today. */
  windowStart: string;
  windowEnd: string;
  timezone: string;
  setterId: string | null;
  createdAt: string;
}

export interface BroadcastMessageView {
  id: string;
  contactId: string;
  bubbles: string[];
  followupBubbles: string[];
  status: BroadcastMessageStatus;
  edited: boolean;
  scheduledAt: string | null;
  sentAt: string | null;
  error: string | null;
  /** J's note (live/quiet, what it used). */
  reasoning?: string | null;
  /** Link guard: "already_had_link" (drafted, collapsed and unapproved in Review). */
  leftOutReason?: string | null;
  includedAnyway?: boolean;
  skipReason?: SkipReason | null;
  /** Links in what Kevin sent himself ("Send myself"). */
  sentLinks?: string[];
}

/** Job data for the os-broadcast-send slot (lib/os/setter/queue.ts). */
export interface BroadcastSendJob {
  messageId: string;
  /** "main" or the follow-up message a few minutes later. */
  part: "main" | "followup";
  /** The planned time (ms) the job was queued for; a moved message makes it stale. */
  at?: number;
}

export interface BroadcastRunView {
  id: string;
  broadcastId: string;
  /** "YYYY-MM-DD" in the broadcast timezone. */
  runDate: string;
  /** Legacy weekly link (migrated runs); links live on the bubbles now. */
  link: string | null;
  status: BroadcastRunStatus;
  /** When the drafts were (re)made: an inbound after this skips the draft. */
  createdAt: string;
}

/** What the audience and J read about one contact. */
export interface BroadcastContact {
  contactId: string;
  username: string | null;
  fullName: string | null;
  kind: "SALES" | "PERSONAL" | "UNSORTED" | "PITCHES";
  paused: boolean;
  tags: string[];
  igUserId: string | null;
  conversationId: string | null;
  /** Their last message (opens Meta's 24h window). */
  theirLastAt: string | null;
  /** Our last message. */
  ourLastAt: string | null;
  setterStage: string | null;
  stage: string | null;
  notes: string | null;
  /** Known custom field values ("Niche: fitness coaching"). */
  fields: { label: string; value: string }[];
  /** In a live workflow run (lib/os/workflows): skipped if they had a message in the last 48h (O3). */
  inWorkflow?: boolean;
  archived?: boolean;
  /** Spam (the heuristic, or Kevin's sticky override). */
  spam?: boolean;
  /** Contact.lastInboundAt (the inbound webhook), when known. */
  lastInboundAt?: string | null;
}

/** A message with the bits the timeline and the panel show. */
export interface BroadcastMessageRow extends BroadcastMessageView {
  runId: string;
  runDate: string;
  broadcastKey: string;
  broadcastName: string;
}
