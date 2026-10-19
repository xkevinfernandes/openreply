// Public voice-note files: see lib/os/voice/serve.ts. Zernio and Instagram
// fetch these without a session, so the only key is the random id.
import { prisma } from "@/lib/db/client";
import { serveVoice } from "@/lib/os/voice/serve";

export const dynamic = "force-dynamic";

async function load(id: string) {
  return prisma.voiceAudio.findUnique({ where: { id }, select: { mimeType: true, ext: true, bytes: true } });
}

export async function GET(request: Request, ctx: { params: Promise<{ file: string }> }) {
  return serveVoice(request, (await ctx.params).file, load);
}

export async function HEAD(request: Request, ctx: { params: Promise<{ file: string }> }) {
  return serveVoice(request, (await ctx.params).file, load);
}
