import { NextRequest, NextResponse } from "next/server";
import { disconnectInstagram } from "@/lib/os/conn/instagram";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can disconnect accounts" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const instagramAccountId =
    typeof body.instagramAccountId === "string" ? body.instagramAccountId : null;

  // Unsubscribes our webhook at Meta (own Meta app), deletes the token, logs it.
  const result = await disconnectInstagram(context.workspaceId, {
    accountId: instagramAccountId,
    actorId: context.userId,
  });

  return NextResponse.json({
    success: true,
    ...(result.revokeError
      ? { warning: "Meta didn't confirm the webhook unsubscribe. The token is deleted; remove the app in Instagram → Settings → Apps and websites to finish." }
      : {}),
  });
}
