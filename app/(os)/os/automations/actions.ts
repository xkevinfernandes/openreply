"use server";

// Automations' own writes: which setter answers a campaign (CampaignSetter)
// and which lead magnet its keyword hands out (CampaignResource). Campaign
// edits themselves go through OpenReply's /api/automations.

import { revalidatePath } from "next/cache";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { osMockEnabled } from "@/lib/os/mock";

export interface AutomationActionResult {
  error?: string;
}

async function ownCampaign(automationId: string): Promise<{ workspaceId: string } | { error: string }> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  const auto = await prisma.automation.findFirst({ where: { id: automationId, workspaceId }, select: { id: true } });
  if (!auto) return { error: "That campaign isn't in this workspace." };
  return { workspaceId };
}

function refresh(automationId: string) {
  revalidatePath("/os/automations");
  revalidatePath(`/os/automations/${automationId}`);
}

export async function setCampaignSetter(automationId: string, setterId: string | null): Promise<AutomationActionResult> {
  if (osMockEnabled() && automationId.startsWith("sample-")) return {};
  try {
    const own = await ownCampaign(automationId);
    if ("error" in own) return own;
    const { workspaceId } = own;
    if (!setterId) {
      await prisma.campaignSetter.deleteMany({ where: { automationId, workspaceId } });
    } else {
      const setter = await prisma.setter.findFirst({ where: { id: setterId, workspaceId }, select: { id: true } });
      if (!setter) return { error: "That setter isn't in this workspace." };
      await prisma.campaignSetter.upsert({ where: { automationId }, create: { workspaceId, automationId, setterId }, update: { setterId } });
    }
    refresh(automationId);
    return {};
  } catch (err) {
    console.error("[OS Automations] setter:", err);
    return { error: "Couldn't save that. Try again." };
  }
}

/** Keyword → resource. null clears it (the link decides again). */
export async function setCampaignResource(automationId: string, resourceId: string | null): Promise<AutomationActionResult> {
  if (osMockEnabled() && automationId.startsWith("sample-")) return {};
  try {
    const own = await ownCampaign(automationId);
    if ("error" in own) return own;
    const { workspaceId } = own;
    if (!resourceId) {
      await prisma.campaignResource.deleteMany({ where: { automationId, workspaceId } });
    } else {
      const res = await prisma.resource.findFirst({ where: { id: resourceId, workspaceId, kind: "resource" }, select: { id: true } });
      if (!res) return { error: "That lead magnet isn't in this workspace." };
      await prisma.campaignResource.upsert({ where: { automationId }, create: { workspaceId, automationId, resourceId }, update: { resourceId } });
    }
    refresh(automationId);
    return {};
  } catch (err) {
    console.error("[OS Automations] resource:", err);
    return { error: "Couldn't save that. Try again." };
  }
}
