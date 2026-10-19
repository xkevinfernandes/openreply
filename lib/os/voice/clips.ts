// The Voice notes section of a knowledge base: the clips, their audio, and
// the suggested slots a new setter starts with. Writes are scoped to the
// workspace by the callers (app/(os)/os/knowledge/voice-actions.ts and the
// upload route).

import { prisma } from "@/lib/db/client";
import { audioDuration, AUDIO_MIME, describeUnsupported, MAX_AUDIO_BYTES, MAX_DURATION_MS, sniffAudio, type AudioExt } from "@/lib/os/voice/audio";
import { voicePath } from "@/lib/os/voice/send";
import { VOICE_SLOTS } from "@/lib/os/voice/slots";
import { newAudioId } from "@/lib/os/voice/store";

export interface VoiceClipView {
  id: string;
  slot: string | null;
  label: string;
  phrase: string;
  stage: string | null;
  kind: "bank" | "manual";
  leadIn: boolean;
  active: boolean;
  url: string | null;
  durationMs: number | null;
  /** How many people heard it. */
  sends: number;
}

type Row = Awaited<ReturnType<typeof loadRows>>[number];

function loadRows(workspaceId: string, setterId: string) {
  return prisma.voiceClip.findMany({
    where: { workspaceId, setterId },
    include: { audio: { select: { id: true, ext: true, durationMs: true } } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

function view(c: Row, sends: Map<string, number>): VoiceClipView {
  return {
    id: c.id,
    slot: c.slot,
    label: c.label,
    phrase: c.phrase,
    stage: c.stage,
    kind: c.kind === "MANUAL" ? "manual" : "bank",
    leadIn: c.leadIn,
    active: c.active,
    url: c.audio ? voicePath(c.audio.id, c.audio.ext) : null,
    durationMs: c.audio?.durationMs ?? null,
    sends: sends.get(c.id) ?? 0,
  };
}

/** A setter with no clips at all starts with the 15 suggested lines as empty slots. */
export async function ensureVoiceSlots(workspaceId: string, setterId: string): Promise<void> {
  const n = await prisma.voiceClip.count({ where: { setterId } });
  if (n) return;
  await prisma.voiceClip.createMany({
    data: VOICE_SLOTS.map((s, i) => ({
      workspaceId,
      setterId,
      slot: s.slot,
      label: s.slot,
      phrase: s.phrase,
      stage: s.stage,
      leadIn: Boolean(s.leadIn),
      kind: "BANK" as const,
      active: false,
      sortOrder: i,
    })),
  });
}

export async function listVoiceClips(workspaceId: string, setterId: string): Promise<VoiceClipView[]> {
  await ensureVoiceSlots(workspaceId, setterId);
  const rows = await loadRows(workspaceId, setterId);
  const counts = await prisma.voiceSend.groupBy({
    by: ["clipId"],
    where: { workspaceId, clipId: { in: rows.map((r) => r.id) }, status: "sent" },
    _count: { _all: true },
  });
  const sends = new Map(counts.map((c) => [c.clipId!, c._count._all]));
  return rows.map((r) => view(r, sends));
}

/** Clips Kevin can send by hand to this contact: their setter's, then any other. */
export async function sendableClips(workspaceId: string, setterId: string | null): Promise<VoiceClipView[]> {
  const rows = await prisma.voiceClip.findMany({
    where: { workspaceId, audioId: { not: null } },
    include: { audio: { select: { id: true, ext: true, durationMs: true } } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const own = rows.filter((r) => r.setterId === setterId);
  const list = own.length ? own : rows;
  // Manual clips first: that is what the mic button is for.
  return list.map((r) => view(r, new Map())).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "manual" ? -1 : 1));
}

export class AudioRejected extends Error {}

export interface StoredAudio {
  id: string;
  ext: AudioExt;
  durationMs: number | null;
  url: string;
}

/** Store one recording. The bytes decide the type; Instagram's formats only. */
export async function storeAudio(workspaceId: string, bytes: Uint8Array, clientDurationMs?: number | null): Promise<StoredAudio> {
  if (!bytes.length) throw new AudioRejected("The file is empty.");
  if (bytes.length > MAX_AUDIO_BYTES) throw new AudioRejected("That file is over 12 MB. Voice notes should be a few seconds.");
  const ext = sniffAudio(bytes);
  if (!ext) throw new AudioRejected(`Instagram doesn't take ${describeUnsupported(bytes)} audio. Use m4a, wav or aac (the page converts recordings for you).`);
  // Recorders that stream (fragmented mp4) leave the header at 0: ask the browser then.
  const fromFile = audioDuration(bytes, ext);
  const read = fromFile && fromFile > 0 ? fromFile : null;
  const fromClient = clientDurationMs != null && Number.isFinite(clientDurationMs) && clientDurationMs > 0 ? Math.round(clientDurationMs) : null;
  const durationMs = read ?? fromClient;
  if (durationMs != null && durationMs > MAX_DURATION_MS) throw new AudioRejected("That's over 5 minutes. Keep voice notes short.");
  const id = newAudioId();
  await prisma.voiceAudio.create({
    data: { id, workspaceId, mimeType: AUDIO_MIME[ext], ext, bytes: new Uint8Array(bytes), sizeBytes: bytes.length, durationMs },
  });
  return { id, ext, durationMs, url: voicePath(id, ext) };
}

/** Drop a recording nothing points at any more (sent ones stay: the thread plays them). */
export async function dropAudioIfUnused(audioId: string | null): Promise<void> {
  if (!audioId) return;
  const [clips, sends] = await Promise.all([
    prisma.voiceClip.count({ where: { audioId } }),
    prisma.voiceSend.count({ where: { audioId } }),
  ]);
  if (!clips && !sends) await prisma.voiceAudio.deleteMany({ where: { id: audioId } });
}

/** Give a clip its recording. The first recording switches it on. */
export async function attachAudio(workspaceId: string, clipId: string, audio: StoredAudio): Promise<void> {
  const clip = await prisma.voiceClip.findFirst({ where: { id: clipId, workspaceId }, select: { id: true, audioId: true } });
  if (!clip) throw new AudioRejected("That clip is gone. Refresh the page.");
  await prisma.voiceClip.update({ where: { id: clip.id }, data: { audioId: audio.id, ...(clip.audioId ? {} : { active: true }) } });
  await dropAudioIfUnused(clip.audioId);
}
