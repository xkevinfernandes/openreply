"use server";

// Setter chat: plain-words changes → proposed per-doc edits. Apply writes
// through the doc save path (History, author "Setter chat"). Scoped to the
// signed-in workspace like every Knowledge write.

import { revalidatePath } from "next/cache";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { runChat, type ChatEdit, type ChatTest } from "@/lib/os/setter/chat/assistant";
import { addChatMessage, applyChatEdit, clearChat, discardChatEdit, listChat, type ChatMessageView } from "@/lib/os/setter/chat/store";
import { getSetterConfig } from "@/lib/os/setter/config";
import { profileFromRow } from "@/lib/os/setter/kb";
import { loadMethod } from "@/lib/os/setter/knowledge";
import { correctionPair } from "@/lib/os/setter/knowledge/corrections";
import { loadDocs } from "@/lib/os/setter/knowledge/doc-store";
import { sandboxReply } from "@/lib/os/setter/sandbox";
import { dbKnowledge } from "@/lib/os/setter/setters";

const MAX_MSG = 4000;

async function own(setterId: string) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) throw new Error("Sign in again.");
  const s = await prisma.setter.findFirst({ where: { id: setterId, workspaceId } });
  if (!s) throw new Error("That setter is gone. Refresh the page.");
  return { workspaceId, setter: s };
}

const fail = (err: unknown, fallback: string) => {
  console.error("[OS Setter chat]", err);
  return { error: err instanceof Error ? err.message : fallback };
};

export async function loadSetterChat(setterId: string): Promise<{ error?: string; messages?: ChatMessageView[] }> {
  try {
    await own(setterId);
    return { messages: await listChat(setterId) };
  } catch (err) {
    return fail(err, "Couldn't load the chat.");
  }
}

export async function sendSetterChat(setterId: string, text: string): Promise<{ error?: string; messages?: ChatMessageView[] }> {
  const message = (typeof text === "string" ? text : "").trim().slice(0, MAX_MSG);
  if (!message) return { error: "Write something first." };
  let ctx: Awaited<ReturnType<typeof own>>;
  try {
    ctx = await own(setterId);
  } catch (err) {
    return fail(err, "Couldn't send it.");
  }
  const history = await listChat(setterId).catch(() => []);
  const mine = await addChatMessage(setterId, { role: "user", text: message });
  try {
    const docs = await loadDocs(setterId);
    const profile = profileFromRow(ctx.setter, docs);
    const corrections = profile.voiceCorrections.slice(-5).reverse().map(correctionPair);
    const answer = await runChat(
      { setterName: ctx.setter.name, docs, corrections, history: history.map((m) => ({ role: m.role, text: m.text, edits: m.edits })), message },
      getSetterConfig().drafter,
      loadMethod()
    );
    let test: ChatTest | null = null;
    if (answer.test) {
      test = { lead: answer.test, bubbles: [], hold: false, stage: null };
      try {
        const setter = await dbKnowledge.forSetter(ctx.workspaceId, setterId);
        if (!setter) throw new Error("setter not found");
        const r = await sandboxReply(setter, answer.test.map((t) => ({ from: "lead" as const, text: t })));
        test = { ...test, bubbles: r.bubbles, hold: r.hold, stage: r.stage };
      } catch (err) {
        test = { ...test, error: err instanceof Error ? err.message : "The test didn't run." };
      }
    }
    const edits: ChatEdit[] = answer.edits.map((e) => ({ ...e, status: "proposed" }));
    const reply = await addChatMessage(setterId, { role: "assistant", text: answer.reply, edits, test });
    return { messages: [mine, reply] };
  } catch (err) {
    return { ...fail(err, "No answer. Try again."), messages: [mine] };
  }
}

export async function applySetterChatEdit(setterId: string, messageId: string, editId: string): Promise<{ error?: string; edits?: ChatEdit[]; doc?: string }> {
  try {
    await own(setterId);
    const r = await applyChatEdit(setterId, messageId, editId);
    if (!r.ok) return { error: r.error, edits: r.edits };
    await prisma.setter.update({ where: { id: setterId }, data: { updatedAt: new Date() } });
    revalidatePath(`/os/knowledge/${setterId}`);
    return { edits: r.edits, doc: r.doc };
  } catch (err) {
    return fail(err, "Couldn't apply it.");
  }
}

export async function discardSetterChatEdit(setterId: string, messageId: string, editId: string): Promise<{ error?: string; edits?: ChatEdit[] }> {
  try {
    await own(setterId);
    const edits = await discardChatEdit(setterId, messageId, editId);
    return edits ? { edits } : { error: "That message is gone." };
  } catch (err) {
    return fail(err, "Couldn't discard it.");
  }
}

export async function clearSetterChat(setterId: string): Promise<{ error?: string }> {
  try {
    await own(setterId);
    await clearChat(setterId);
    return {};
  } catch (err) {
    return fail(err, "Couldn't clear it.");
  }
}
