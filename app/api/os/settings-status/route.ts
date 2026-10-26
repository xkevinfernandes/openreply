import { NextResponse } from "next/server";
import { SETTINGS_TABS, type SettingsTab } from "@/lib/os/settings";
import { statusLine } from "@/lib/os/settings-status";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

// The Settings list's slow status lines, filled in after the page renders.
// ?tabs=diagnostics,integrations

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const asked = (new URL(request.url).searchParams.get("tabs") ?? "").split(",");
  const tabs = SETTINGS_TABS.map((t) => t.tab).filter((t): t is SettingsTab => asked.includes(t));
  const lines = await Promise.all(tabs.map((t) => statusLine(context.workspaceId, t).catch(() => "—")));
  return NextResponse.json({ success: true, data: Object.fromEntries(tabs.map((t, i) => [t, lines[i]])) });
}
