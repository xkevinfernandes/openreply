// Audio files for voice notes, the pure half: what a file is (by its bytes,
// never its name), how long it plays, the unguessable ids in public urls, and
// a generated tone for sample data. Instagram accepts aac, m4a, wav and mp4
// audio (Meta's Messenger Platform docs), so those are stored as they are;
// anything else (webm from Chrome's recorder, mp3, ogg) is converted to WAV
// in the browser before upload (components/os/voice/prepare-audio.ts).
// No Node imports: the browser uses encodeWav and formatDuration too.

export type AudioExt = "m4a" | "wav" | "aac";

export const AUDIO_MIME: Record<AudioExt, string> = {
  m4a: "audio/mp4",
  wav: "audio/wav",
  aac: "audio/aac",
};

/** Instagram's limit is 25 MB; voice notes are far smaller. */
export const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
/** Bank clips are a few seconds; a personal note can run a few minutes. */
export const MAX_DURATION_MS = 5 * 60_000;

export const AUDIO_ID = /^[A-Za-z0-9_-]{32}$/;

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

/** What the bytes are, or null when Instagram wouldn't take them as they are. */
export function sniffAudio(b: Uint8Array): AudioExt | null {
  if (b.length < 12) return null;
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WAVE") return "wav";
  if (ascii(b, 4, 4) === "ftyp") return "m4a";
  // AAC in ADTS frames: 12-bit sync word, layer 0.
  if (b[0] === 0xff && (b[1]! & 0xf6) === 0xf0) return "aac";
  return null;
}

/** A name for what Instagram won't take, for the error message. */
export function describeUnsupported(b: Uint8Array): string {
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "WebM";
  if (b.length >= 4 && ascii(b, 0, 4) === "OggS") return "Ogg";
  if (b.length >= 3 && (ascii(b, 0, 3) === "ID3" || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0))) return "MP3";
  return "this kind of file";
}

const u32 = (b: Uint8Array, at: number) => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
const le32 = (b: Uint8Array, at: number) => (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;

function wavDuration(b: Uint8Array): number | null {
  let byteRate = 0;
  for (let at = 12; at + 8 <= b.length; ) {
    const id = ascii(b, at, 4);
    const size = le32(b, at + 4);
    if (id === "fmt " && at + 16 <= b.length) byteRate = le32(b, at + 16);
    if (id === "data") return byteRate ? Math.round((Math.min(size, b.length - at - 8) / byteRate) * 1000) : null;
    at += 8 + size + (size % 2);
  }
  return null;
}

/** mvhd's duration / timescale, walking moov's boxes. */
function mp4Duration(b: Uint8Array): number | null {
  const walk = (from: number, to: number): number | null => {
    for (let at = from; at + 8 <= to; ) {
      let size = u32(b, at);
      const type = ascii(b, at + 4, 4);
      if (size === 1 && at + 16 <= to) size = u32(b, at + 8) * 2 ** 32 + u32(b, at + 12);
      if (size === 0) size = to - at;
      if (size < 8) return null;
      if (type === "moov") return walk(at + 8, Math.min(at + size, to));
      if (type === "mvhd") {
        const v = b[at + 8];
        const timescale = v === 1 ? u32(b, at + 28) : u32(b, at + 20);
        const duration = v === 1 ? u32(b, at + 32) * 2 ** 32 + u32(b, at + 36) : u32(b, at + 24);
        return timescale ? Math.round((duration / timescale) * 1000) : null;
      }
      at += size;
    }
    return null;
  };
  return walk(0, b.length);
}

/** How long it plays, read from the file itself; null when it can't tell. */
export function audioDuration(b: Uint8Array, ext: AudioExt): number | null {
  try {
    if (ext === "wav") return wavDuration(b);
    if (ext === "m4a") return mp4Duration(b);
  } catch {
    return null;
  }
  return null;
}

/** 16-bit mono PCM samples (-1..1) as a WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(out.buffer);
  const str = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

/** Sample data (OS_MOCK): a soft two-note chime, so the flow can be heard. */
export function sampleToneWav(seconds = 1.6, sampleRate = 22050): Uint8Array {
  const n = Math.round(seconds * sampleRate);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const f = t < seconds / 2 ? 660 : 880;
    const local = t < seconds / 2 ? t : t - seconds / 2;
    const env = Math.min(1, local * 40) * Math.exp(-local * 3.2);
    s[i] = 0.35 * env * Math.sin(2 * Math.PI * f * t);
  }
  return encodeWav(s, sampleRate);
}

/** "0:04" */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  const s = Math.max(1, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
