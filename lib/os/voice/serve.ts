// GET /api/os/voice/<id>.<ext>: the public file Zernio and Instagram fetch.
// No sign-in (they can't sign in); the 192-bit random id is the key, an
// unknown or malformed name is a plain 404 that says nothing, and there is no
// listing route. Byte ranges are honoured (Safari's <audio> needs them).

import { AUDIO_ID } from "@/lib/os/voice/audio";

export interface ServedAudio {
  mimeType: string;
  ext: string;
  bytes: Uint8Array;
}

export type AudioLoader = (id: string) => Promise<ServedAudio | null>;

const FILE = /^([A-Za-z0-9_-]+)\.(m4a|wav|aac)$/;

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

export async function serveVoice(request: Request, file: string, load: AudioLoader): Promise<Response> {
  const m = FILE.exec(file);
  if (!m || !AUDIO_ID.test(m[1]!)) return notFound();
  const audio = await load(m[1]!);
  if (!audio || audio.ext !== m[2]) return notFound();

  const total = audio.bytes.length;
  const headers: Record<string, string> = {
    "Content-Type": audio.mimeType,
    "Accept-Ranges": "bytes",
    // The id never points at different bytes: a new recording gets a new id.
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  let start = 0;
  let end = total - 1;
  let status = 200;
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
    } else {
      start = Math.max(0, total - Number(range[2]));
    }
    if (start > end || start >= total) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
    }
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${total}`;
  }
  const body = audio.bytes.slice(start, end + 1);
  headers["Content-Length"] = String(body.length);
  return new Response(request.method === "HEAD" ? null : body, { status, headers });
}
