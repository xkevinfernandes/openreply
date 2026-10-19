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

type StoryRef = { messageId: string; storyId: string | null; assetId: string | null; at: string | null };

/** Story replies whose card is missing (Data OS wasn't connected when the
 *  media job ran, or the job never ran). */
export function missingStoryRefs(
  messages: { id: string; at: string | null; parts: { type: string; storyId?: string | null; assetId?: string | null; mention?: boolean }[] }[],
  media: Map<string, MediaView>
): StoryRef[] {
  const out: StoryRef[] = [];
  for (const m of messages) {
    const p = m.parts.find((x) => x.type === "story_reply" && !x.mention);
    if (!p || (!p.storyId && !p.assetId) || media.get(m.id)?.story) continue;
    out.push({ messageId: m.id, storyId: p.storyId ?? null, assetId: p.assetId ?? null, at: m.at });
  }
  return out;
}

/** Fill missing story cards from Data OS at read time (a few per thread) and
 *  cache them on the MessageMedia row. Never throws. */
export async function fillStoryCards(
  workspaceId: string,
  messages: Parameters<typeof missingStoryRefs>[0],
  media: Map<string, MediaView>,
  limit = 6
): Promise<Map<string, MediaView>> {
  const refs = missingStoryRefs(messages, media).slice(-limit);
  if (!refs.length) return media;
  try {
    const { dataOsFor } = await import("@/lib/os/dataos/store");
    const os = await dataOsFor(workspaceId);
    if (!os) return media;
    const { dbMediaStore } = await import("@/lib/os/media/store");
    const rows = await dbMediaStore.get(workspaceId, refs.map((r) => r.messageId));
    const out = new Map(media);
    await Promise.all(
      refs.map(async (r) => {
        const story = await os.storyFor(r).catch(() => null);
        if (!story) return;
        const prev = out.get(r.messageId);
        out.set(r.messageId, prev ? { ...prev, story } : { messageId: r.messageId, kind: "story_reply", status: "done", transcript: null, description: null, caption: null, durationMs: null, story });
        const row = rows.get(r.messageId);
        if (row) await dbMediaStore.save({ ...row, story, provider: row.provider ?? "dataos" }).catch(() => undefined);
      })
    );
    return out;
  } catch (err) {
    console.error("[OS Media] story cards failed:", err instanceof Error ? err.message : err);
    return media;
  }
}
