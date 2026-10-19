// Message media enrichment (voice transcripts, image descriptions, captions,
// story cards). The thread (S1) reads mediaForMessages; J reads the same rows
// through readSetterThread (lib/os/setter/thread.ts). Owner: S2.

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

/** Enrichment rows for these message ids, keyed by message id. Sample rows
 *  under OS_MOCK. Never throws: a thread renders without media text. */
export async function mediaForMessages(workspaceId: string, messageIds: string[]): Promise<Map<string, MediaView>> {
  if (!messageIds.length) return new Map();
  try {
    const { osMockEnabled } = await import("@/lib/os/mock");
    if (osMockEnabled()) {
      const { mockMediaForMessages } = await import("@/lib/os/mock-media");
      return mockMediaForMessages(messageIds);
    }
    const [{ dbMediaStore }, { toView }] = await Promise.all([import("@/lib/os/media/store"), import("@/lib/os/media/enrich")]);
    const rows = await dbMediaStore.get(workspaceId, messageIds);
    return new Map([...rows].map(([id, r]) => [id, toView(r)]));
  } catch (err) {
    console.error("[OS Media] mediaForMessages failed:", err instanceof Error ? err.message : err);
    return new Map();
  }
}
