import { NextResponse } from "next/server";
import { diagnosticsSummary, parseOnly } from "@/lib/os/diagnostics";
import { diagnosticsDetails, mockDetails, readChecks, sendingToday } from "@/lib/os/diagnostics-reads";
import { osMockEnabled } from "@/lib/os/mock";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

// Settings › Diagnostics: the health list for the signed-in member's own
// workspace. ?only=worker,webhook,token runs just those (cached 60 s per
// workspace); ?details=1 adds the old detail lists (the shared reads).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; body: unknown }>();

export async function GET(request: Request) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const onlyRaw = url.searchParams.get("only");
  const keys = parseOnly(onlyRaw);
  const wantDetails = url.searchParams.get("details") === "1";
  // Details are part of the key: a cached plain check has none (it said "the queue didn't answer").
  const cacheKey = onlyRaw ? `${context.workspaceId}:${keys.join(",")}${wantDetails ? ":details" : ""}` : null;
  if (cacheKey && url.searchParams.get("fresh") !== "1") {
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_MS) return NextResponse.json(hit.body);
  }

  const [checks, sending, details] = await Promise.all([
    readChecks(context.workspaceId, keys),
    onlyRaw ? null : sendingToday(context.workspaceId).catch(() => null),
    !wantDetails ? null : osMockEnabled() ? mockDetails() : diagnosticsDetails(context.workspaceId).catch(() => null),
  ]);
  const body = { success: true, data: { checks, summary: diagnosticsSummary(checks), sending, details, checkedAt: new Date().toISOString() } };
  if (cacheKey) cache.set(cacheKey, { at: Date.now(), body });
  return NextResponse.json(body);
}
