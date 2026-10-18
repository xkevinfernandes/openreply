import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { decryptToken, encryptToken } from "@/lib/meta/oauth";
import { createKitClient, KitApiError } from "@/lib/crm/kit";
import { canManageWorkspace, getCurrentWorkspaceContext, type WorkspaceContext } from "@/lib/workspace-access";

// The email list a workspace's email gates sync into. One Kit key per workspace.

const keySchema = z.object({ apiKey: z.string().trim().min(10).max(512) });

class KitRouteError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function allowedOrigins(request: Request) {
  const origins = new Set([new URL(request.url).origin]);
  if (process.env.NEXTAUTH_URL) origins.add(new URL(process.env.NEXTAUTH_URL).origin);
  return origins;
}

function withKitManagement(handler: (context: WorkspaceContext, request: Request) => Promise<Response>) {
  return async (request: Request) => {
    try {
      const context = await getCurrentWorkspaceContext();
      if (!context) throw new KitRouteError("Sign in to manage your email list.", 401);
      if (!canManageWorkspace(context.role)) throw new KitRouteError("Only workspace owners and admins can manage the email list.", 403);
      if (request.method !== "GET") {
        const origin = request.headers.get("origin");
        if (origin && !allowedOrigins(request).has(origin)) throw new KitRouteError("Invalid request origin.", 403);
      }
      return await handler(context, request);
    } catch (error) {
      if (error instanceof KitRouteError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
      if (error instanceof KitApiError) {
        const message = error.status === 401 ? "The Kit API key is invalid." : error.status === 403 ? "This Kit key can't access that. Use a v4 API key with full access." : "Kit didn't respond. Please retry.";
        return NextResponse.json({ success: false, error: message }, { status: 502 });
      }
      return NextResponse.json({ success: false, error: "Could not update the email list connection." }, { status: 500 });
    }
  };
}

export const GET = withKitManagement(async ({ workspaceId }) => {
  const saved = await prisma.crmConnection.findUnique({ where: { workspaceId_provider: { workspaceId, provider: "KIT" } } });
  if (!saved) return NextResponse.json({ success: true, data: { configured: false, tags: [] } });
  const tags = await createKitClient(decryptToken(saved.apiKey)).listTags();
  return NextResponse.json({ success: true, data: { configured: true, tags } });
});

export const POST = withKitManagement(async ({ workspaceId }, request) => {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new KitRouteError("Send a JSON request body.");
  const parsed = keySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new KitRouteError("Paste your Kit API key.");
  await createKitClient(parsed.data.apiKey).verify();
  await prisma.crmConnection.upsert({
    where: { workspaceId_provider: { workspaceId, provider: "KIT" } },
    create: { workspaceId, provider: "KIT", apiKey: encryptToken(parsed.data.apiKey) },
    update: { apiKey: encryptToken(parsed.data.apiKey) },
  });
  return NextResponse.json({ success: true });
});

export const DELETE = withKitManagement(async ({ workspaceId }) => {
  await prisma.crmConnection.deleteMany({ where: { workspaceId, provider: "KIT" } });
  return NextResponse.json({ success: true });
});
