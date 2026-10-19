// OS_MOCK sample data for the Inbox thread (S1): rich messages for every
// sample conversation (Maya's board thread from lib/os/mock.ts plus whatever
// was sent or simulated since), the media rows, lead magnet chips and opener
// keywords, and held drafts. Never on in production.

import type { MediaView } from "@/lib/os/media";
import type { RichMessage } from "@/lib/os/messages/types";
import { MAYA, MOCK_LEAD_MAGNET_BY_MESSAGE, mayaThread, mockMediaFor, mockMessages, mockRichMessages } from "@/lib/os/mock";
import { mockDataOs } from "@/lib/os/dataos/mock";

function rich(m: ReturnType<typeof mockMessages>[number]): RichMessage {
  return {
    id: m.id,
    direction: m.fromMe ? "outgoing" : "incoming",
    fromMe: m.fromMe,
    at: m.createdTime,
    parts: m.voice
      ? [{ type: "voice", url: m.voice.url, durationMs: m.voice.durationMs }]
      : m.attachment
        ? [{ type: "image", url: null }]
        : [{ type: "text", text: m.text }],
    reactions: [],
    seenAt: null,
    deliveryStatus: m.fromMe ? "sent" : null,
    origin: m.fromMe ? "api" : null,
    automationId: null,
    fromSetter: false,
    quotedMessageId: null,
    deleted: false,
    edited: false,
    refreshUrl: null,
  };
}

/** The sample thread as rich messages, oldest first. */
export function mockThreadMessages(conversationId: string): RichMessage[] {
  if (conversationId !== MAYA.conversationId) {
    // Text samples, with sent voice notes and screenshots kept as parts.
    const base = mockRichMessages(conversationId);
    const byId = new Map(mockMessages(conversationId).map((m) => [m.id, m]));
    return base.map((m) => {
      const src = byId.get(m.id);
      return src && (src.voice || src.attachment) ? rich(src) : m;
    });
  }
  const board = mayaThread();
  const ids = new Set(board.map((m) => m.id));
  const extra = mockMessages(conversationId)
    .filter((m) => !ids.has(m.id))
    .map(rich);
  return [...board, ...extra];
}

/** Media rows for a sample thread (voice transcripts, story card, caption). */
export async function mockThreadMedia(conversationId: string, messages: RichMessage[]): Promise<Record<string, MediaView>> {
  const out: Record<string, MediaView> = Object.fromEntries(mockMediaFor(conversationId));
  // Story replies with no card yet get one from the sample Data OS.
  for (const m of messages) {
    const p = m.parts.find((x) => x.type === "story_reply");
    if (!p || p.type !== "story_reply" || out[m.id]?.story) continue;
    const s = await mockDataOs.storyFor({ storyId: p.storyId, assetId: p.assetId, at: m.at });
    if (s) out[m.id] = { messageId: m.id, kind: "story_reply", status: "done", transcript: null, description: null, caption: null, durationMs: null, story: s };
  }
  // Voice notes we sent on sample data carry their own line.
  for (const src of mockMessages(conversationId)) {
    if (src.voice && !out[src.id]) {
      out[src.id] = { messageId: src.id, kind: "voice", status: "done", transcript: src.voice.transcript, description: null, caption: null, durationMs: src.voice.durationMs, story: null };
    }
  }
  return out;
}

export const MOCK_OPENER_BY_AUTOMATION: Record<string, string> = { "auto-setter": "SETTER", "auto-script": "SCRIPT" };

export function mockLeadMagnets(): Record<string, string> {
  return { ...MOCK_LEAD_MAGNET_BY_MESSAGE };
}

/** Sample drafts Kevin held (Draft.heldAt on real data). */
const held = ((globalThis as { __osMockHeld?: Map<string, { at: string; reason: string | null }> }).__osMockHeld ??= new Map());

export function markMockHeld(draftId: string, reason: string | null) {
  held.set(draftId, { at: new Date().toISOString(), reason });
}

/** Sent sample drafts (the J marker on what was approved since load). */
export function mockSentDrafts(contactId: string | null): { bubbles: string[]; editedText?: string | null }[] {
  const mem = (globalThis as { __osSetterMock?: { drafts: Map<string, { contactId: string; status: string; bubbles: string[] }> } }).__osSetterMock;
  if (!mem || !contactId) return [];
  return [...mem.drafts.values()].filter((d) => d.contactId === contactId && d.status === "SENT").map((d) => ({ bubbles: d.bubbles }));
}
