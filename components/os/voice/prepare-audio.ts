// Browser side of voice notes: get any recording or upload into a format
// Instagram takes, then upload it. m4a / aac / wav go up untouched (iPhone
// voice memos are m4a); webm (Chrome's recorder), mp3 and ogg are decoded with
// Web Audio and re-encoded as mono 16-bit WAV. Instagram accepts aac, m4a,
// wav and mp4 audio (Meta Messenger Platform docs).

import { encodeWav } from "@/lib/os/voice/audio";

const WAV_RATE = 22050;

async function head(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(0, 12).arrayBuffer());
}

function nativeKind(b: Uint8Array): "m4a" | "wav" | "aac" | null {
  const s = (at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
  if (b.length < 12) return null;
  if (s(0, 4) === "RIFF" && s(8, 4) === "WAVE") return "wav";
  if (s(4, 4) === "ftyp") return "m4a";
  if (b[0] === 0xff && (b[1]! & 0xf6) === 0xf0) return "aac";
  return null;
}

async function decode(blob: Blob): Promise<AudioBuffer> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    return await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    void ctx.close();
  }
}

/** Mono, resampled to 22.05 kHz: plenty for a voice and small enough to store. */
async function toWav(buf: AudioBuffer): Promise<Blob> {
  const frames = Math.max(1, Math.ceil(buf.duration * WAV_RATE));
  const off = new OfflineAudioContext(1, frames, WAV_RATE);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  const out = await off.startRendering();
  return new Blob([encodeWav(out.getChannelData(0), WAV_RATE) as BlobPart], { type: "audio/wav" });
}

export interface PreparedAudio {
  blob: Blob;
  durationMs: number | null;
}

export async function prepareAudio(input: Blob): Promise<PreparedAudio> {
  const kind = nativeKind(await head(input));
  let decoded: AudioBuffer | null = null;
  try {
    decoded = await decode(input);
  } catch {
    decoded = null;
  }
  const durationMs = decoded ? Math.round(decoded.duration * 1000) : null;
  if (kind) return { blob: input, durationMs };
  if (!decoded) throw new Error("This browser couldn't read that file. Try an m4a, mp3 or wav.");
  return { blob: await toWav(decoded), durationMs };
}

export interface UploadedAudio {
  id: string;
  ext: string;
  durationMs: number | null;
  url: string;
}

/** Converts if needed, then stores it (attached to a clip when clipId is given). */
export async function uploadAudio(input: Blob, clipId?: string | null): Promise<UploadedAudio> {
  const { blob, durationMs } = await prepareAudio(input);
  const q = new URLSearchParams();
  if (clipId) q.set("clipId", clipId);
  if (durationMs) q.set("durationMs", String(durationMs));
  const res = await fetch(`/api/os/voice-upload?${q}`, { method: "POST", body: blob, headers: { "Content-Type": blob.type || "application/octet-stream" } });
  const body = (await res.json().catch(() => ({}))) as { audio?: UploadedAudio; error?: string };
  if (!res.ok || !body.audio) throw new Error(body.error ?? "The recording didn't save. Try again.");
  return body.audio;
}

/** AAC in mp4 (an m4a, like Instagram's own voice notes) when the browser can
 *  record it; otherwise its default (webm/opus), converted to WAV on upload.
 *  Plain "audio/mp4" is not enough: Chrome can put Opus in it. */
export function recorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MediaRecorder.isTypeSupported("audio/mp4;codecs=mp4a.40.2") ? "audio/mp4;codecs=mp4a.40.2" : undefined;
}
