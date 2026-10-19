// Setter chat history (SetterChatMessage, prisma/os-kb2.prisma) and Apply:
// an accepted edit is written through the doc save path (saveDocBody), so
// History records it with the author "Setter chat".

import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { applyEdit } from "@/lib/os/setter/chat/diff";
import type { ChatEdit, ChatTest, EditStatus } from "@/lib/os/setter/chat/assistant";
import { loadDocs, saveDocBody } from "@/lib/os/setter/knowledge/doc-store";
import { isDocKey } from "@/lib/os/setter/knowledge/docs";

export const CHAT_AUTHOR = "Setter chat";
const KEEP = 80;

export interface ChatMessageView {
  id: string;
  role: "user" | "assistant";
  text: string;
  edits: ChatEdit[];
  test: ChatTest | null;
  at: string;
}

const STATUSES: EditStatus[] = ["proposed", "applied", "discarded", "stale"];

export function asEdits(v: unknown): ChatEdit[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    const e = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    if (typeof e.id !== "string" || !isDocKey(e.doc)) return [];
    return [
      {
        id: e.id,
        doc: e.doc,
        before: typeof e.before === "string" ? e.before : "",
        after: typeof e.after === "string" ? e.after : "",
        why: typeof e.why === "string" ? e.why : "",
        status: STATUSES.includes(e.status as EditStatus) ? (e.status as EditStatus) : "proposed",
      },
    ];
  });
}

function asTest(v: unknown): ChatTest | null {
  if (!v || typeof v !== "object") return null;
  const t = v as Record<string, unknown>;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
  return { lead: list(t.lead), bubbles: list(t.bubbles), hold: Boolean(t.hold), stage: typeof t.stage === "string" ? t.stage : null, ...(typeof t.error === "string" ? { error: t.error } : {}) };
}

type Row = { id: string; role: string; text: string; edits: unknown; test: unknown; createdAt: Date };

export function viewOf(r: Row): ChatMessageView {
  return { id: r.id, role: r.role === "user" ? "user" : "assistant", text: r.text, edits: asEdits(r.edits), test: asTest(r.test), at: r.createdAt.toISOString() };
}

export async function listChat(setterId: string): Promise<ChatMessageView[]> {
  const rows = await prisma.setterChatMessage.findMany({ where: { setterId }, orderBy: { createdAt: "desc" }, take: KEEP });
  return rows.reverse().map(viewOf);
}

export async function addChatMessage(
  setterId: string,
  m: { role: "user" | "assistant"; text: string; edits?: ChatEdit[]; test?: ChatTest | null; author?: string | null }
): Promise<ChatMessageView> {
  const row = await prisma.setterChatMessage.create({
    data: {
      setterId,
      role: m.role,
      text: m.text,
      edits: (m.edits ?? []) as unknown as Prisma.InputJsonValue,
      ...(m.test ? { test: m.test as unknown as Prisma.InputJsonValue } : {}),
      author: m.author ?? null,
    },
  });
  return viewOf(row);
}

export async function clearChat(setterId: string): Promise<void> {
  await prisma.setterChatMessage.deleteMany({ where: { setterId } });
}

async function setStatus(messageId: string, edits: ChatEdit[], editId: string, status: EditStatus) {
  const next = edits.map((e) => (e.id === editId ? { ...e, status } : e));
  await prisma.setterChatMessage.update({ where: { id: messageId }, data: { edits: next as unknown as Prisma.InputJsonValue } });
  return next;
}

export type ApplyResult = { ok: true; doc: string; body: string; edits: ChatEdit[] } | { ok: false; error: string; edits?: ChatEdit[] };

/** Apply one proposed edit: re-read the doc, apply, save with History. A doc
 *  that changed under the edit marks it stale instead of guessing. */
export async function applyChatEdit(setterId: string, messageId: string, editId: string, now = new Date()): Promise<ApplyResult> {
  const msg = await prisma.setterChatMessage.findFirst({ where: { id: messageId, setterId } });
  if (!msg) return { ok: false, error: "That message is gone." };
  const edits = asEdits(msg.edits);
  const edit = edits.find((e) => e.id === editId);
  if (!edit) return { ok: false, error: "That edit is gone." };
  if (edit.status === "applied") return { ok: false, error: "Already applied.", edits };
  const docs = await loadDocs(setterId);
  const next = applyEdit(docs[edit.doc] ?? "", edit);
  if (next === null) {
    return { ok: false, error: "The doc changed since. Ask again.", edits: await setStatus(msg.id, edits, editId, "stale") };
  }
  await saveDocBody(setterId, edit.doc, next, CHAT_AUTHOR, now);
  return { ok: true, doc: edit.doc, body: next, edits: await setStatus(msg.id, edits, editId, "applied") };
}

export async function discardChatEdit(setterId: string, messageId: string, editId: string): Promise<ChatEdit[] | null> {
  const msg = await prisma.setterChatMessage.findFirst({ where: { id: messageId, setterId } });
  if (!msg) return null;
  const edits = asEdits(msg.edits);
  if (!edits.some((e) => e.id === editId && e.status === "proposed")) return edits;
  return setStatus(msg.id, edits, editId, "discarded");
}
