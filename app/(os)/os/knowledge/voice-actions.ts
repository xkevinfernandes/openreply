"use server";

// Knowledge base → Voice notes: edit, add and remove clips. Recordings upload
// through /api/os/voice-upload (bodies over 1 MB). Every write is scoped to
// the signed-in workspace.

import { revalidatePath } from "next/cache";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { osMockEnabled } from "@/lib/os/mock";
import { sampleToneWav } from "@/lib/os/voice/audio";
import { attachAudio, dropAudioIfUnused, storeAudio } from "@/lib/os/voice/clips";

export interface VoiceActionResult {
  error?: string;
}

export interface VoiceClipPatch {
  label?: string;
  phrase?: string;
  stage?: string | null;
  kind?: "bank" | "manual";
  leadIn?: boolean;
  active?: boolean;
}

async function own(clipId: string) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) throw new Error("Sign in again.");
  const clip = await prisma.voiceClip.findFirst({ where: { id: clipId, workspaceId } });
  if (!clip) throw new Error("That clip is gone. Refresh the page.");
  return { workspaceId, clip };
}

async function attempt(fn: () => Promise<void>): Promise<VoiceActionResult> {
  try {
    await fn();
    return {};
  } catch (err) {
    console.error("[OS Voice]", err);
    return { error: err instanceof Error ? err.message : "That didn't save. Try again." };
  }
}

export async function updateVoiceClip(clipId: string, patch: VoiceClipPatch): Promise<VoiceActionResult> {
  let setterId: string | null = null;
  const r = await attempt(async () => {
    const { clip } = await own(clipId);
    setterId = clip.setterId;
    const data: Record<string, unknown> = {};
    if (patch.label !== undefined) data.label = patch.label.trim().slice(0, 80);
    if (patch.phrase !== undefined) data.phrase = patch.phrase.replace(/\s+/g, " ").trim().slice(0, 500);
    if (patch.stage !== undefined) data.stage = patch.stage?.trim().slice(0, 40) || null;
    if (patch.kind !== undefined) data.kind = patch.kind === "manual" ? "MANUAL" : "BANK";
    if (patch.leadIn !== undefined) data.leadIn = Boolean(patch.leadIn);
    if (patch.active !== undefined) {
      if (patch.active && !clip.audioId) throw new Error("Record or upload the clip first.");
      data.active = Boolean(patch.active);
    }
    await prisma.voiceClip.update({ where: { id: clip.id }, data });
  });
  if (!r.error && setterId) revalidatePath(`/os/knowledge/${setterId}`);
  return r;
}

export async function addVoiceClip(setterId: string, kind: "bank" | "manual"): Promise<VoiceActionResult & { id?: string }> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  const setter = await prisma.setter.findFirst({ where: { id: setterId, workspaceId }, select: { id: true } });
  if (!setter) return { error: "That knowledge base is gone. Refresh the page." };
  const last = await prisma.voiceClip.findFirst({ where: { setterId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const clip = await prisma.voiceClip.create({
    data: { workspaceId, setterId, kind: kind === "manual" ? "MANUAL" : "BANK", label: kind === "manual" ? "New voice note" : "New line", sortOrder: (last?.sortOrder ?? -1) + 1 },
  });
  revalidatePath(`/os/knowledge/${setterId}`);
  return { id: clip.id };
}

export async function deleteVoiceClip(clipId: string): Promise<VoiceActionResult> {
  let setterId: string | null = null;
  const r = await attempt(async () => {
    const { clip } = await own(clipId);
    setterId = clip.setterId;
    await prisma.voiceClip.delete({ where: { id: clip.id } });
    await dropAudioIfUnused(clip.audioId);
  });
  if (!r.error && setterId) revalidatePath(`/os/knowledge/${setterId}`);
  return r;
}

/** Remove a clip's recording (keeps the line; switches it off). */
export async function clearVoiceAudio(clipId: string): Promise<VoiceActionResult> {
  let setterId: string | null = null;
  const r = await attempt(async () => {
    const { clip } = await own(clipId);
    setterId = clip.setterId;
    await prisma.voiceClip.update({ where: { id: clip.id }, data: { audioId: null, active: false } });
    await dropAudioIfUnused(clip.audioId);
  });
  if (!r.error && setterId) revalidatePath(`/os/knowledge/${setterId}`);
  return r;
}

/** Sample data only: give a slot a generated chime so the flow can be heard. */
export async function applySampleTone(clipId: string): Promise<VoiceActionResult> {
  if (!osMockEnabled()) return { error: "Only on sample data." };
  let setterId: string | null = null;
  const r = await attempt(async () => {
    const { workspaceId, clip } = await own(clipId);
    setterId = clip.setterId;
    const audio = await storeAudio(workspaceId, sampleToneWav());
    await attachAudio(workspaceId, clip.id, audio);
  });
  if (!r.error && setterId) revalidatePath(`/os/knowledge/${setterId}`);
  return r;
}
