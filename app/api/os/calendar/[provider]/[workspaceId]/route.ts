// Cal.com / Calendly webhooks for the DM OS: cancels, reschedules and
// no-shows move J's follow-ups (lib/os/sequences/calendar-sync.ts).
// Unauthenticated by design; every request must carry the provider's
// signature made with this workspace's secret (OsIntegration.webhookSecret).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import { isCalendarProvider } from "@/lib/os/integrations/calendar/types";
import { parseCalcomEvent, parseCalendlyEvent, verifyCalcomSignature, verifyCalendlySignature } from "@/lib/os/sequences/calendar-events";
import { applyCalendarEvent } from "@/lib/os/sequences/calendar-sync";

export async function POST(request: Request, segmentData: { params: Promise<{ provider: string; workspaceId: string }> }) {
  const { provider, workspaceId } = await segmentData.params;
  if (!isCalendarProvider(provider)) return NextResponse.json({ error: "Unknown calendar" }, { status: 404 });
  const row = await prisma.osIntegration.findUnique({ where: { workspaceId_provider: { workspaceId, provider } }, select: { webhookSecret: true } });
  if (!row?.webhookSecret) return NextResponse.json({ error: "Webhooks are not set up for this calendar" }, { status: 404 });
  let secret: string;
  try {
    secret = decryptToken(row.webhookSecret);
  } catch {
    return NextResponse.json({ error: "Webhook secret unreadable; set webhooks up again" }, { status: 500 });
  }

  const rawBody = await request.text();
  const ok =
    provider === "calcom"
      ? verifyCalcomSignature(rawBody, request.headers.get("x-cal-signature-256"), secret)
      : verifyCalendlySignature(rawBody, request.headers.get("calendly-webhook-signature"), secret);
  if (!ok) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const event = provider === "calcom" ? parseCalcomEvent(body) : parseCalendlyEvent(body);
  try {
    const result = await applyCalendarEvent(workspaceId, provider, event);
    return NextResponse.json({ success: true, trigger: event.trigger, ...result });
  } catch (err) {
    console.error(`[OS Calendar] ${provider} webhook failed:`, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Processing failed; retry delivery." }, { status: 500 });
  }
}
