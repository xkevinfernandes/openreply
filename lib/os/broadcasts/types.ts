// Broadcasts (Follow-up Friday). Wave-0 contract; owner: S5.

export type BroadcastRunStatus = "drafting" | "review" | "scheduled" | "done";
export type BroadcastMessageStatus = "drafted" | "approved" | "scheduled" | "sent" | "skipped" | "failed" | "outside_window";

export const FOLLOW_UP_FRIDAY = { key: "follow-up-friday", tag: "follow-up-friday", name: "Follow-up Friday" } as const;

/** One-off broadcast status (dm-crm slice 5, stored on Broadcast.status). */
export type BroadcastStatus = "draft" | "drafting" | "in_review" | "scheduled" | "sending" | "sent" | "cancelled";
export const BROADCAST_STATUSES: readonly BroadcastStatus[] = ["draft", "drafting", "in_review", "scheduled", "sending", "sent", "cancelled"];
export type BroadcastStartMode = "now" | "window";
export type PersonaliseMode = "per_person" | "variations" | "as_written";
/** One bubble of a broadcast's message (Broadcast.bubbles). A link bubble with
 *  url null still needs a link ("pick a resource or link"). */
export type BroadcastBubble = { type: "text"; text: string } | { type: "link"; url: string | null; resourceId?: string | null };

/** Parse Broadcast.bubbles (JSON) defensively. */
export function parseBubbles(v: unknown): BroadcastBubble[] {
  if (!Array.isArray(v)) return [];
  const out: BroadcastBubble[] = [];
  for (const b of v) {
    if (!b || typeof b !== "object") continue;
    const o = b as Record<string, unknown>;
    if (o.type === "text" && typeof o.text === "string") out.push({ type: "text", text: o.text });
    else if (o.type === "link") out.push({ type: "link", url: typeof o.url === "string" && o.url ? o.url : null, resourceId: typeof o.resourceId === "string" ? o.resourceId : null });
  }
  return out;
}

/** The link of a broadcast's bubbles (the first link bubble's), or null. */
export function bubblesLink(bubbles: BroadcastBubble[]): string | null {
  for (const b of bubbles) if (b.type === "link") return b.url;
  return null;
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
  /** "YYYY-MM-DD" in timezone (window mode). */
  sendDate: string | null;
  bubbles: BroadcastBubble[];
  personaliseMode: PersonaliseMode;
  /** variations mode: the 5 variations of the text bubbles. */
  variations: string[][];
  duplicatedFromId: string | null;
  /** Legacy weekly shape, derived (the columns are gone): the link bubble's url. */
  link: string | null;
  template: string;
  followupTemplate: string | null;
  followupDelayMin: number;
  /** Legacy, derived: the weekday of sendDate (0 = Sunday … 6 = Saturday), else Friday. */
  windowDay: number;
  windowStart: string;
  windowEnd: string;
  timezone: string;
  setterId: string | null;
  /** Legacy, derived: anything past draft. */
  enabled: boolean;
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
}

/** Job data for the os-broadcast-send slot (lib/os/setter/queue.ts). */
export interface BroadcastSendJob {
  messageId: string;
  /** "main" or the follow-up message a few minutes later. */
  part: "main" | "followup";
  /** The planned time (ms) the job was queued for; a moved message makes it stale. */
  at?: number;
}

// ---------------------------------------------------------------- S5 additions

export interface BroadcastRunView {
  id: string;
  broadcastId: string;
  /** "YYYY-MM-DD" in the broadcast timezone. */
  runDate: string;
  /** Legacy weekly link; links live on the broadcast's bubbles now. */
  link: string | null;
  status: BroadcastRunStatus;
  createdAt: string;
}

/** What the audience and J read about one tagged contact. */
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
  /** In a live workflow run (lib/os/workflows): Friday skips them if they had a message in the last 48h (O3). */
  inWorkflow?: boolean;
}

/** A message with the bits the timeline and the panel show. */
export interface BroadcastMessageRow extends BroadcastMessageView {
  runId: string;
  runDate: string;
  broadcastKey: string;
  broadcastName: string;
}

