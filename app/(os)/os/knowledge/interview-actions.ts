"use server";

// "New setter": draft the starter docs from the interview, then save the
// reviewed draft as a new setter. Existing setters are never written here.

import { revalidatePath } from "next/cache";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { getSetterConfig } from "@/lib/os/setter/config";
import { loadMethod } from "@/lib/os/setter/knowledge";
import { generateSetterDraft, type SetterDraft } from "@/lib/os/setter/interview/generate";
import { answered, cleanAnswers } from "@/lib/os/setter/interview/questions";
import { createSetterFromDraft } from "@/lib/os/setter/interview/save";

export async function draftNewSetter(raw: unknown): Promise<{ error?: string; draft?: SetterDraft }> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  const answers = cleanAnswers(raw);
  if (answered(answers) < 3) return { error: "Answer at least three." };
  try {
    return { draft: await generateSetterDraft(answers, getSetterConfig().drafter, loadMethod()) };
  } catch (err) {
    console.error("[OS New setter]", err);
    return { error: err instanceof Error ? `Couldn't write it: ${err.message}` : "Couldn't write it. Try again." };
  }
}

export async function saveNewSetter(draft: SetterDraft): Promise<{ error?: string; id?: string }> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  try {
    const { setterId } = await createSetterFromDraft(workspaceId, draft);
    revalidatePath("/os/knowledge", "layout");
    return { id: setterId };
  } catch (err) {
    console.error("[OS New setter] save failed:", err);
    return { error: err instanceof Error ? err.message : "Couldn't save it." };
  }
}
