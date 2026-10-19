"use server";

import { revalidatePath } from "next/cache";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { osMockEnabled } from "@/lib/os/mock";
import { experimentStore } from "@/lib/os/experiments/store";
import { parseSlot } from "@/lib/os/experiments/types";
import { cleanInput, type ExperimentInput } from "@/lib/os/experiments/validate";

async function requireWorkspace() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) throw new Error("Sign in again.");
  return workspaceId;
}

function refresh() {
  revalidatePath("/os/automations/tests");
}

export async function createExperiment(raw: ExperimentInput): Promise<{ error?: string; id?: string }> {
  const workspaceId = await requireWorkspace();
  const store = experimentStore();
  const busy = (await store.list(workspaceId)).filter((e) => e.status === "RUNNING").map((e) => e.slot);
  const r = cleanInput(raw, busy);
  if ("error" in r) return { error: r.error };
  const v = r.value;
  const slot = parseSlot(v.slot)!;
  if (!osMockEnabled()) {
    if (slot.kind === "campaign_opener") {
      const a = await prisma.automation.findFirst({ where: { id: slot.ref, workspaceId }, select: { id: true } });
      if (!a) return { error: "That campaign isn't in this workspace." };
    }
    if (v.setterId) {
      const s = await prisma.setter.findFirst({ where: { id: v.setterId, workspaceId }, select: { id: true } });
      if (!s) return { error: "That setter isn't in this workspace." };
    }
  }
  const e = await store.create({ workspaceId, ...v });
  refresh();
  return { id: e.id };
}

export async function setExperimentStatus(id: string, status: "RUNNING" | "PAUSED" | "FINISHED"): Promise<{ error?: string }> {
  const workspaceId = await requireWorkspace();
  if (!["RUNNING", "PAUSED", "FINISHED"].includes(status)) return { error: "Unknown status." };
  const store = experimentStore();
  const e = await store.get(workspaceId, id);
  if (!e) return { error: "That test is gone. Refresh the page." };
  if (status === "RUNNING") {
    const clash = (await store.list(workspaceId)).find((x) => x.id !== id && x.status === "RUNNING" && x.slot === e.slot);
    if (clash) return { error: `"${clash.name}" is already running there. Pause it first.` };
  }
  await store.setStatus(workspaceId, id, status);
  refresh();
  return {};
}

export async function pickWinner(id: string, variantId: string): Promise<{ error?: string }> {
  const workspaceId = await requireWorkspace();
  const ok = await experimentStore().pickWinner(workspaceId, id, variantId);
  refresh();
  return ok ? {} : { error: "That variant is gone. Refresh the page." };
}
