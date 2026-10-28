import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import {
  getRequestIp,
  hashClickIp,
  parseRecipientToken,
} from "@/lib/tracking/server";

type RedirectRouteProps = {
  params: Promise<{ slug: string }>;
};

/**
 * A DM OS workflow link (no automation): the click is a `link_clicked` event
 * on its run (lib/os/workflows), which is what the canvas and DataOS read.
 * Never blocks the redirect.
 */
async function workflowClick(link: { id: string; runId: string | null; nodeId: string | null; resourceSlug: string | null }) {
  if (!link.runId) return;
  try {
    const run = await prisma.workflowRun.findUnique({
      where: { id: link.runId },
      select: { id: true, workspaceId: true, workflowId: true, versionId: true },
    });
    if (!run) return;
    await prisma.workflowRunEvent.create({
      data: {
        workspaceId: run.workspaceId,
        workflowId: run.workflowId,
        versionId: run.versionId,
        runId: run.id,
        nodeId: link.nodeId ?? "",
        kind: "link_clicked",
        data: { slug: link.resourceSlug, link: link.id },
      },
    });
  } catch (err) {
    console.error("[Redirect] workflow click not logged:", err instanceof Error ? err.message : err);
  }
}

export async function GET(request: NextRequest, { params }: RedirectRouteProps) {
  const { slug } = await params;
  const trackedLink = await prisma.trackedLink.findUnique({
    where: { slug },
    select: {
      id: true,
      workspaceId: true,
      automationId: true,
      destinationUrl: true,
      runId: true,
      nodeId: true,
      resourceSlug: true,
      automation: {
        select: {
          instagramAccountId: true,
        },
      },
    },
  });

  if (!trackedLink) {
    return NextResponse.redirect(new URL("/", request.url), { status: 302 });
  }

  if (!trackedLink.automationId || !trackedLink.automation) {
    await workflowClick(trackedLink);
    return NextResponse.redirect(trackedLink.destinationUrl, { status: 302 });
  }

  await prisma.linkClick.create({
    data: {
      workspaceId: trackedLink.workspaceId,
      automationId: trackedLink.automationId,
      instagramAccountId: trackedLink.automation.instagramAccountId,
      trackedLinkId: trackedLink.id,
      ipHash: hashClickIp(getRequestIp(request)),
      recipientHash: parseRecipientToken(
        new URL(request.url).searchParams.get("r")
      ),
      userAgent: request.headers.get("user-agent"),
      referrer: request.headers.get("referer"),
    },
  });

  return NextResponse.redirect(trackedLink.destinationUrl, { status: 302 });
}
