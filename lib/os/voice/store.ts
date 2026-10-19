// Where voice notes live and who heard what. Clips and audio are always in
// Postgres (the Knowledge base editor writes them, sample data or not); the
// send log is Postgres, or in memory with OS_MOCK=1 (sample contacts aren't
// rows). J's approve path talks to the VoiceBank interface, so tests swap in
// a memory one.

import { randomBytes } from "node:crypto";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import type { InboxVoice } from "@/lib/os/inbox";
import { osMockEnabled } from "@/lib/os/mock";
import type { BankClip } from "@/lib/os/voice/match";
import { sendAudioMessage, voicePath } from "@/lib/os/voice/send";

/** 32 url-safe characters from 24 random bytes (192 bits): the only key to a file. */
export function newAudioId(): string {
  return randomBytes(24).toString("base64url");
}

export interface VoiceContact {
  id: string;
  workspaceId: string;
  igUserId: string;
  conversationId: string | null;
}

export interface VoiceClaim {
  workspaceId: string;
  contactId: string;
  conversationId: string | null;
  clip: BankClip;
  draftId: string | null;
}

export interface VoiceBank {
  /** The setter's active bank clips that have audio, and the ones this person heard. */
  load(contact: VoiceContact, setterId: string | null): Promise<{ clips: BankClip[]; heard: string[] }>;
  /** Claim "this person hears this clip". Null when they already did (or a race won). */
  claim(c: VoiceClaim): Promise<string | null>;
  /** The send failed before anything went out: forget the claim. */
  release(sendId: string): Promise<void>;
  /** Sends the clip's audio; returns Instagram's message id when known. */
  sendAudio(contact: VoiceContact, clip: BankClip, sendId: string, humanAgent: boolean): Promise<string | null>;
  sent(sendId: string, messageId: string | null): Promise<void>;
}

type ClipRow = Prisma.VoiceClipGetPayload<{ include: { audio: { select: { id: true; ext: true; durationMs: true } } } }>;

export function bankClipOf(c: ClipRow): BankClip | null {
  if (!c.audio) return null;
  return {
    id: c.id,
    label: c.label,
    phrase: c.phrase,
    leadIn: c.leadIn,
    audioId: c.audio.id,
    ext: c.audio.ext,
    url: voicePath(c.audio.id, c.audio.ext),
    durationMs: c.audio.durationMs,
  };
}

const audioSelect = { select: { id: true, ext: true, durationMs: true } } as const;

/** Active bank clips with audio, in the editor's order. */
export async function activeBankClips(workspaceId: string, setterId: string): Promise<BankClip[]> {
  const rows = await prisma.voiceClip.findMany({
    where: { workspaceId, setterId, kind: "BANK", active: true, audioId: { not: null } },
    include: { audio: audioSelect },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(bankClipOf).filter((c): c is BankClip => Boolean(c));
}

async function sendClip(contact: VoiceContact, clip: BankClip, sendId: string, humanAgent: boolean) {
  const r = await sendAudioMessage({
    workspaceId: contact.workspaceId,
    igUserId: contact.igUserId,
    conversationId: contact.conversationId,
    audioId: clip.audioId,
    ext: clip.ext,
    transcript: clip.phrase,
    durationMs: clip.durationMs,
    humanAgent,
    sendKey: sendId,
  });
  return r.messageId;
}

const bankKey = (contactId: string, clipId: string) => `${contactId}:${clipId}`;

const dbBank: VoiceBank = {
  async load(contact, setterId) {
    if (!setterId) return { clips: [], heard: [] };
    const [clips, heard] = await Promise.all([
      activeBankClips(contact.workspaceId, setterId),
      prisma.voiceSend.findMany({ where: { contactId: contact.id, clipId: { not: null } }, select: { clipId: true } }),
    ]);
    return { clips, heard: heard.map((h) => h.clipId!) };
  },
  async claim(c) {
    try {
      const row = await prisma.voiceSend.create({
        data: {
          workspaceId: c.workspaceId,
          contactId: c.contactId,
          conversationId: c.conversationId,
          clipId: c.clip.id,
          audioId: c.clip.audioId,
          kind: "bank",
          transcript: c.clip.phrase,
          bankKey: bankKey(c.contactId, c.clip.id),
          draftId: c.draftId,
        },
      });
      return row.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return null;
      throw err;
    }
  },
  async release(sendId) {
    await prisma.voiceSend.deleteMany({ where: { id: sendId, status: "sending" } });
  },
  sendAudio: sendClip,
  async sent(sendId, messageId) {
    await prisma.voiceSend.update({ where: { id: sendId }, data: { status: "sent", messageId, sentAt: new Date() } });
  },
};

// ---------------------------------------------------------------- OS_MOCK
interface MockSend {
  id: string;
  contactId: string;
  conversationId: string | null;
  clipId: string | null;
  bankKey: string | null;
  messageId: string | null;
  status: string;
}

const mem = ((globalThis as { __osVoiceMock?: { sends: MockSend[]; seq: number } }).__osVoiceMock ??= { sends: [], seq: 0 });

const mockBank: VoiceBank = {
  async load(contact, setterId) {
    const clips = setterId ? await activeBankClips(contact.workspaceId, setterId) : [];
    return { clips, heard: mem.sends.filter((s) => s.contactId === contact.id && s.clipId).map((s) => s.clipId!) };
  },
  async claim(c) {
    const key = bankKey(c.contactId, c.clip.id);
    if (mem.sends.some((s) => s.bankKey === key)) return null;
    const id = `mock-voice-${++mem.seq}`;
    mem.sends.push({ id, contactId: c.contactId, conversationId: c.conversationId, clipId: c.clip.id, bankKey: key, messageId: null, status: "sending" });
    return id;
  },
  async release(sendId) {
    mem.sends = mem.sends.filter((s) => !(s.id === sendId && s.status === "sending"));
  },
  sendAudio: sendClip,
  async sent(sendId, messageId) {
    const s = mem.sends.find((x) => x.id === sendId);
    if (s) Object.assign(s, { status: "sent", messageId });
  },
};

export function voiceBank(): VoiceBank {
  return osMockEnabled() ? mockBank : dbBank;
}

// ---------------------------------------------------------------- manual sends
export interface ManualVoice {
  workspaceId: string;
  contact: VoiceContact;
  /** A clip from the setter's list, or a one-off recording's audio id. */
  clipId?: string | null;
  audioId?: string | null;
  transcript?: string | null;
  humanAgent?: boolean;
}

/** Kevin's own send from the composer: direct, no approval, not once-per-person. */
export async function sendManualVoice(m: ManualVoice): Promise<void> {
  let audio: { id: string; ext: string; durationMs: number | null } | null = null;
  let transcript = (m.transcript ?? "").trim().slice(0, 500);
  let clipId: string | null = null;
  let kind = "oneoff";
  if (m.clipId) {
    const clip = await prisma.voiceClip.findFirst({ where: { id: m.clipId, workspaceId: m.workspaceId }, include: { audio: audioSelect } });
    if (!clip?.audio) throw new Error("That clip has no recording yet.");
    audio = clip.audio;
    transcript ||= clip.phrase || clip.label;
    clipId = clip.id;
    kind = clip.kind === "BANK" ? "bank" : "manual";
  } else if (m.audioId) {
    audio = await prisma.voiceAudio.findFirst({ where: { id: m.audioId, workspaceId: m.workspaceId }, select: audioSelect.select });
    if (!audio) throw new Error("That recording is gone. Record it again.");
  }
  if (!audio) throw new Error("Pick a clip or record one first.");

  const mock = osMockEnabled();
  const id = mock ? `mock-voice-${++mem.seq}` : null;
  const row = mock
    ? null
    : await prisma.voiceSend.create({
        data: {
          workspaceId: m.workspaceId,
          contactId: m.contact.id,
          conversationId: m.contact.conversationId,
          clipId,
          audioId: audio.id,
          kind,
          transcript,
        },
      });
  const sendId = row?.id ?? id!;
  try {
    const r = await sendAudioMessage({
      workspaceId: m.workspaceId,
      igUserId: m.contact.igUserId,
      conversationId: m.contact.conversationId,
      audioId: audio.id,
      ext: audio.ext,
      transcript,
      durationMs: audio.durationMs,
      humanAgent: m.humanAgent,
      sendKey: sendId,
    });
    if (row) await prisma.voiceSend.update({ where: { id: row.id }, data: { status: "sent", messageId: r.messageId, sentAt: new Date() } });
    // A bank clip sent by hand counts as heard: J won't play it to them again.
    else mem.sends.push({ id: sendId, contactId: m.contact.id, conversationId: m.contact.conversationId, clipId, bankKey: null, messageId: r.messageId, status: "sent" });
  } catch (err) {
    if (row) await prisma.voiceSend.delete({ where: { id: row.id } }).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------- the thread
/** Voice notes sent into a conversation, by Instagram message id. */
export async function voiceByMessage(workspaceId: string, conversationId: string): Promise<Map<string, InboxVoice>> {
  const rows = await prisma.voiceSend.findMany({
    where: { workspaceId, conversationId, status: "sent", messageId: { not: null } },
    select: { messageId: true, audioId: true, transcript: true, kind: true },
    take: 400,
    orderBy: { sentAt: "desc" },
  });
  if (!rows.length) return new Map();
  const audios = await prisma.voiceAudio.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.audioId))] } }, select: { id: true, ext: true, durationMs: true } });
  const byId = new Map(audios.map((a) => [a.id, a]));
  const out = new Map<string, InboxVoice>();
  for (const r of rows) {
    const a = byId.get(r.audioId);
    if (!a || !r.messageId) continue;
    out.set(r.messageId, { url: voicePath(a.id, a.ext), transcript: r.transcript, durationMs: a.durationMs, kind: r.kind });
  }
  return out;
}

/** For J's transcript: our voice notes read as what was said. */
export async function voiceTranscripts(workspaceId: string, conversationId: string): Promise<Map<string, string>> {
  const map = await voiceByMessage(workspaceId, conversationId);
  return new Map([...map].map(([id, v]) => [id, v.transcript ? `[voice note] ${v.transcript}` : "[voice note]"]));
}
