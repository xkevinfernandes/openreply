import { NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { diagnosticsDetails } from "@/lib/os/diagnostics-reads";

export const runtime = "nodejs";

export async function GET() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  // The same reads Settings › Diagnostics uses (lib/os/diagnostics-reads.ts).
  return NextResponse.json({ success: true, data: await diagnosticsDetails(workspaceId) });
}
