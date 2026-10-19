// Broadcasts (Follow-up Friday). Wave-0 contract; owner: S5.

export type BroadcastRunStatus = "drafting" | "review" | "scheduled" | "done";
export type BroadcastMessageStatus = "drafted" | "approved" | "scheduled" | "sent" | "skipped" | "failed" | "outside_window";

export const FOLLOW_UP_FRIDAY = { key: "follow-up-friday", tag: "follow-up-friday", name: "Follow-up Friday" } as const;

export interface BroadcastView {
  id: string;
  key: string;
  name: string;
  audienceTag: string;
  link: string | null;
  template: string;
  followupTemplate: string | null;
  followupDelayMin: number;
  /** 0 = Sunday … 6 = Saturday. */
  windowDay: number;
  windowStart: string;
  windowEnd: string;
  timezone: string;
  setterId: string | null;
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
  link: string;
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
}

/** A message with the bits the timeline and the panel show. */
export interface BroadcastMessageRow extends BroadcastMessageView {
  runId: string;
  runDate: string;
  broadcastKey: string;
  broadcastName: string;
}

/** Statuses a message can still be changed in (not out of the door yet). */
export const OPEN_STATUSES: BroadcastMessageStatus[] = ["drafted", "approved", "scheduled"];
