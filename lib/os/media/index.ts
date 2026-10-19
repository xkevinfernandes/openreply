// Message media enrichment (voice transcripts, image descriptions, captions,
// story cards). Wave-0 contract; owner: S2 (transcribe, describe, enrich, jobs).

export interface MediaView {
  messageId: string;
  kind: "voice" | "image" | "video" | "share" | "story_reply" | "link" | "file";
  status: "pending" | "done" | "failed" | "skipped" | "expired";
  transcript: string | null;
  description: string | null;
  caption: string | null;
  durationMs: number | null;
  story: { id: string; thumbnailUrl: string | null; caption: string | null; topic: string | null; postedAt: string | null; permalink: string | null } | null;
}

/** Enrichment rows for these message ids, keyed by message id. Stub: empty. */
export async function mediaForMessages(workspaceId: string, messageIds: string[]): Promise<Map<string, MediaView>> {
  void workspaceId;
  void messageIds;
  return new Map();
}
