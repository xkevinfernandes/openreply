// What the draft card shows: which bubbles of J's draft will go as voice.
// Same plan Approve runs (lib/os/setter/service.ts), computed on page load.

import type { DraftView } from "@/lib/os/setter/store";
import { planBubbles } from "@/lib/os/voice/match";
import { voiceBank } from "@/lib/os/voice/store";

export type PreviewPart =
  | { type: "text"; text: string }
  | { type: "voice"; phrase: string; label: string; url: string; durationMs: number | null; leadIn: boolean };

export type DraftVoicePreview = PreviewPart[][];

export async function previewDraftVoice(workspaceId: string, draft: DraftView): Promise<DraftVoicePreview | null> {
  try {
    const { clips, heard } = await voiceBank().load({ id: draft.contactId, workspaceId, igUserId: "", conversationId: null }, draft.setterId ?? null);
    if (!clips.length) return null;
    const plan = planBubbles(draft.bubbles, clips, heard);
    if (!plan.some((b) => b.some((p) => p.type === "voice"))) return null;
    return plan.map((parts) =>
      parts.map((p) =>
        p.type === "text"
          ? p
          : { type: "voice" as const, phrase: p.clip.phrase, label: p.clip.label, url: p.clip.url, durationMs: p.clip.durationMs, leadIn: p.clip.leadIn }
      )
    );
  } catch (err) {
    console.error("[OS Voice] draft preview failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
