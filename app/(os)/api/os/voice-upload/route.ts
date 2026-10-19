// POST a recording (raw bytes in the body). A route handler, not a server
// action: server actions cap bodies at 1 MB and a personal note can be more.
//   ?clipId=…        attach it to that clip (Knowledge base → Voice notes)
//   ?durationMs=…    what the browser measured (the file's own header wins)
// Without clipId it is a one-off recording for the composer to send.
import { NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { AudioRejected, attachAudio, storeAudio } from "@/lib/os/voice/clips";
import { MAX_AUDIO_BYTES } from "@/lib/os/voice/audio";

export const dynamic = "force-dynamic";

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const allowed = new Set([new URL(request.url).origin]);
  if (process.env.NEXTAUTH_URL) allowed.add(new URL(process.env.NEXTAUTH_URL).origin);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) allowed.add(`${new URL(request.url).protocol}//${host}`);
  return allowed.has(origin);
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_AUDIO_BYTES) return NextResponse.json({ error: "That file is over 12 MB." }, { status: 413 });
  const url = new URL(request.url);
  const clipId = url.searchParams.get("clipId");
  const duration = Number(url.searchParams.get("durationMs"));
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    const audio = await storeAudio(workspaceId, bytes, Number.isFinite(duration) ? duration : null);
    if (clipId) await attachAudio(workspaceId, clipId, audio);
    return NextResponse.json({ audio });
  } catch (err) {
    if (err instanceof AudioRejected) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("[OS Voice] upload failed:", err);
    return NextResponse.json({ error: "The recording didn't save. Try again." }, { status: 500 });
  }
}
