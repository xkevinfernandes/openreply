"use server";

// Knowledge bases › setter › Tests: line tests on J's stage lines. A test is
// scoped to this setter (all of J) or, with a workflowId, to one workflow.
// One running test per line per scope; Pick winner switches the loser off
// (people who already had it keep it); Stop finishes the test.

import { revalidatePath } from "next/cache";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { osMockEnabled } from "@/lib/os/mock";
import { LINE_MIN_REACHED } from "@/lib/os/experiments/stats";
import { experimentStore } from "@/lib/os/experiments/store";
import { scopedSlot, STAGE_LINES, stageLineOf } from "@/lib/os/experiments/types";
import { cleanLineVariants, runningClash } from "@/lib/os/experiments/validate";

type Result = { error?: string };

async function scope(setterId: string) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) throw new Error("Sign in again.");
  if (!osMockEnabled()) {
    const s = await prisma.setter.findFirst({ where: { id: setterId, workspaceId }, select: { id: true } });
    if (!s) throw new Error("That knowledge base is gone. Refresh the page.");
  }
  return workspaceId;
}

async function ownTest(setterId: string, id: string) {
  const workspaceId = await scope(setterId);
  const store = experimentStore();
  const e = await store.get(workspaceId, id);
  if (!e || !stageLineOf(e.slot) || (e.setterId && e.setterId !== setterId)) throw new Error("That test is gone. Refresh the page.");
  return { workspaceId, store, e };
}

function done(setterId: string): Result {
  revalidatePath(`/os/knowledge/${setterId}`);
  return {};
}

async function guard(fn: () => Promise<Result>): Promise<Result> {
  try {
    return await fn();
  } catch (err) {
    console.error("[OS Tests]", err);
    return { error: err instanceof Error ? err.message : "That didn't save. Try again." };
  }
}

/** "+ Test": a new test on one stage line, started at once or saved as a draft. */
export async function createLineTest(setterId: string, input: { line: string; texts: string[]; start: boolean; workflowId?: string | null }): Promise<Result> {
  return guard(async () => {
    const workspaceId = await scope(setterId);
    const line = STAGE_LINES.find((l) => l.key === input.line);
    if (!line) return { error: "Pick a line." };
    const v = cleanLineVariants(input.texts, input.start);
    if ("error" in v) return v;
    const slot = scopedSlot(line.slot, input.workflowId);
    const store = experimentStore();
    if (input.start) {
      const clash = runningClash(await store.list(workspaceId), { slot, setterId });
      if (clash) return { error: `A ${line.label.toLowerCase()} test is already running. Stop it first.` };
    }
    await store.create({
      workspaceId,
      setterId,
      name: line.label,
      slot,
      allocation: "EVEN",
      minSends: LINE_MIN_REACHED,
      variants: v.variants,
      status: input.start ? "RUNNING" : "DRAFT",
    });
    return done(setterId);
  });
}

/** A draft's words (and, with start, run it). */
export async function saveLineDraft(setterId: string, id: string, texts: string[], start: boolean): Promise<Result> {
  return guard(async () => {
    const { workspaceId, store, e } = await ownTest(setterId, id);
    if (e.status !== "DRAFT") return { error: "Only a draft can be edited. Stop this one and start a new test." };
    const v = cleanLineVariants(texts, start);
    if ("error" in v) return v;
    if (start) {
      const clash = runningClash(await store.list(workspaceId), { id, slot: e.slot, setterId: e.setterId });
      if (clash) return { error: "A test on this line is already running. Stop it first." };
    }
    if (!(await store.updateDraft(workspaceId, id, v.variants))) return { error: "That draft is gone. Refresh the page." };
    if (start) await store.setStatus(workspaceId, id, "RUNNING");
    return done(setterId);
  });
}

/** Start a paused test again. */
export async function resumeLineTest(setterId: string, id: string): Promise<Result> {
  return guard(async () => {
    const { workspaceId, store, e } = await ownTest(setterId, id);
    const clash = runningClash(await store.list(workspaceId), { id, slot: e.slot, setterId: e.setterId });
    if (clash) return { error: "A test on this line is already running. Stop it first." };
    await store.setStatus(workspaceId, id, "RUNNING");
    return done(setterId);
  });
}

export async function stopLineTest(setterId: string, id: string): Promise<Result> {
  return guard(async () => {
    const { workspaceId, store } = await ownTest(setterId, id);
    await store.setStatus(workspaceId, id, "FINISHED");
    return done(setterId);
  });
}

export async function deleteLineDraft(setterId: string, id: string): Promise<Result> {
  return guard(async () => {
    const { workspaceId, store } = await ownTest(setterId, id);
    if (!(await store.removeDraft(workspaceId, id))) return { error: "Only a draft can be deleted. Use Stop." };
    return done(setterId);
  });
}

export async function pickLineWinner(setterId: string, id: string, variantId: string): Promise<Result> {
  return guard(async () => {
    const { workspaceId, store } = await ownTest(setterId, id);
    if (!(await store.pickWinner(workspaceId, id, variantId))) return { error: "That version is gone. Refresh the page." };
    return done(setterId);
  });
}
