// Sending one audio attachment into an Instagram DM thread.
//
// Zernio: POST /inbox/conversations/{id}/messages with attachmentUrl +
// attachmentType "audio" (docs.zernio.com/messages/send-inbox-message). Zernio
// downloads the url itself (422 attachment_fetch_failed when it can't), so the
// url must be public: /api/os/voice/<id>.<ext>. Meta Graph directly:
// message.attachment {type: "audio", payload: {url}}. Instagram takes aac,
// m4a, wav and mp4 audio up to 25 MB.

import { createHash } from "node:crypto";
import { getBaseUrl, getMetaGraphApiVersion } from "@/lib/env";
import { createInstagramContext } from "@/lib/instagram/provider";
import { appendMockVoice, osMockEnabled } from "@/lib/os/mock";
import { getInboxAccount } from "@/lib/os/inbox";
import { stampSend } from "@/lib/os/send-stamp";
import { assertCanSend, recordSend } from "@/lib/os/sending/cap";
import { zernioRequest, ZernioApiError, ZernioDeliveryUnconfirmedError } from "@/lib/zernio/client";

/** The public url Zernio / Instagram fetch the file from. */
export function voiceUrl(audioId: string, ext: string, base: string = getBaseUrl()): string {
  return `${base.replace(/\/$/, "")}/api/os/voice/${audioId}.${ext}`;
}

/** Same-origin path for the players in the app. */
export function voicePath(audioId: string, ext: string): string {
  return `/api/os/voice/${audioId}.${ext}`;
}

export interface AudioSend {
  workspaceId: string;
  igUserId: string;
  conversationId: string | null;
  audioId: string;
  ext: string;
  /** Shown in the sample-data thread. */
  transcript: string;
  durationMs: number | null;
  humanAgent?: boolean;
  /** Stable per send (the VoiceSend id), so a retried request never doubles. */
  sendKey: string;
  /** Kevin's own voice note from the composer (marks the thread read). J's clips: false. */
  human?: boolean;
  /** The OS contact, for the send stamp. */
  contactId?: string | null;
  /** Kevin's composer: checks neither Pause all nor the cap (Pause all stops automations only). */
  fromComposer?: boolean;
}

export async function sendAudioMessage(s: AudioSend): Promise<{ messageId: string | null }> {
  // Pause all (a voice note is Kevin's, so the setter limit doesn't hold it);
  // Kevin's own from the composer checks neither.
  if (!s.fromComposer) await assertCanSend(s.workspaceId, 1, { source: "voice" });
  const result = await sendAudioUnguarded(s);
  await recordSend(s.workspaceId, { key: `voice:${s.sendKey}`, source: "voice" });
  await stampSend(s.contactId ? { contactId: s.contactId, workspaceId: s.workspaceId } : { workspaceId: s.workspaceId, igUserId: s.igUserId }, { human: s.human === true });
  return result;
}

async function sendAudioUnguarded(s: AudioSend): Promise<{ messageId: string | null }> {
  if (osMockEnabled()) {
    const id = s.conversationId ? appendMockVoice(s.conversationId, { url: voicePath(s.audioId, s.ext), transcript: s.transcript, durationMs: s.durationMs }) : null;
    return { messageId: id };
  }
  const account = await getInboxAccount(s.workspaceId);
  if (!account) throw new Error("Instagram account not connected.");
  const url = voiceUrl(s.audioId, s.ext);
  if (/^https?:\/\/(localhost|127\.|\[::1\])/.test(url)) {
    throw new Error("Voice notes need a public address: set NEXTAUTH_URL to the app's https url so Instagram can fetch the file.");
  }
  const context = await createInstagramContext(account);
  if (context.provider === "META") {
    if (s.humanAgent) throw new Error("Outside the 24-hour window this only sends through Zernio.");
    const res = await fetch(`https://graph.instagram.com/${getMetaGraphApiVersion()}/${account.instagramId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${context.accessToken}` },
      body: JSON.stringify({ recipient: { id: s.igUserId }, message: { attachment: { type: "audio", payload: { url } } } }),
    });
    const body = (await res.json().catch(() => ({}))) as { message_id?: string; error?: { message?: string } };
    if (!res.ok) throw new Error(body.error?.message ?? `Instagram refused the voice note (HTTP ${res.status}).`);
    return { messageId: body.message_id ?? null };
  }
  // Same addressing as the upstream sender: the conversation when we know it
  // (required for HUMAN_AGENT), otherwise the participant id.
  const target = s.conversationId ?? s.igUserId;
  const result = await zernioRequest<{ messageId?: string; data?: { messageId?: string } }>({
    apiKey: context.apiKey,
    method: "POST",
    path: `/inbox/conversations/${encodeURIComponent(target)}/messages`,
    body: {
      accountId: context.accountId,
      attachmentUrl: url,
      attachmentType: "audio",
      ...(s.humanAgent ? { messagingType: "MESSAGE_TAG", messageTag: "HUMAN_AGENT" } : {}),
    },
    idempotencyKey: createHash("sha256").update(`os-voice:${s.sendKey}`).digest("hex"),
  }).catch((err: unknown) => {
    // It may have gone out before a 5xx: never let a blind retry double it.
    if (err instanceof ZernioApiError && err.code >= 500) throw new ZernioDeliveryUnconfirmedError();
    if (err instanceof ZernioApiError && err.code === 422) throw new Error("Zernio couldn't download the voice note from this app. Check NEXTAUTH_URL is the public https address.");
    throw err;
  });
  return { messageId: result?.messageId ?? result?.data?.messageId ?? null };
}
