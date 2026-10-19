// S2 sample data: media rows for OS_MOCK. Maya's board rows come from
// lib/os/mock.ts (mockMediaFor); any other sample voice note or photo gets a
// fake transcript or description, so every voice bubble shows one.

import type { MediaView } from "@/lib/os/media";
import { FAKE_DESCRIPTION } from "@/lib/os/media/describe";
import { FAKE_TRANSCRIPT } from "@/lib/os/media/transcribe";
import { mockMediaFor, mockRichMessages, mockThreads } from "@/lib/os/mock";

export function mockMediaForMessages(messageIds: string[]): Map<string, MediaView> {
  const want = new Set(messageIds);
  const out = new Map<string, MediaView>();
  for (const t of mockThreads()) {
    const known = mockMediaFor(t.conversationId);
    for (const m of mockRichMessages(t.conversationId)) {
      if (!want.has(m.id)) continue;
      const row = known.get(m.id);
      if (row) {
        out.set(m.id, row);
        continue;
      }
      if (m.direction !== "incoming") continue; // our voice notes carry their own line (lib/os/voice)
      const voice = m.parts.find((p) => p.type === "voice");
      const image = m.parts.find((p) => p.type === "image");
      if (!voice && !image) continue;
      out.set(m.id, {
        messageId: m.id,
        kind: voice ? "voice" : "image",
        status: "done",
        transcript: voice ? FAKE_TRANSCRIPT : null,
        description: image ? FAKE_DESCRIPTION : null,
        caption: null,
        durationMs: voice?.type === "voice" ? voice.durationMs : null,
        story: null,
      });
    }
  }
  return out;
}
