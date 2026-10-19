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
}

/** Job data for the os-broadcast-send slot (lib/os/setter/queue.ts). */
export interface BroadcastSendJob {
  messageId: string;
  /** "main" or the follow-up message a few minutes later. */
  part: "main" | "followup";
}
