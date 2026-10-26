// Our own sends, remembered so their Instagram echo isn't taken for Kevin
// typing in the IG app (hooks.workflowOutgoing pauses the run on that).
// The note goes in BEFORE the send: Zernio's outgoing webhook can arrive
// before the send call returns. A send that fails takes its note back out.

import { createHash } from "node:crypto";

export function textHash(text: string): string {
  return createHash("sha256").update(text.trim().toLowerCase().replace(/\s+/g, " ")).digest("hex").slice(0, 32);
}

/** The WorkflowOutbound table, as much of it as this needs (tests pass a fake). */
export interface OutboundTable {
  create(args: { data: { workspaceId: string; igUserId: string; hash: string } }): Promise<{ id: string }>;
  deleteMany(args: { where: { id: string } }): Promise<unknown>;
}

async function table(): Promise<OutboundTable> {
  const { prisma } = await import("@/lib/db/client");
  return prisma.workflowOutbound;
}

/** Note the text as ours, then send; if the send throws, the note is removed and the error goes on. */
export async function sendNoted<T>(workspaceId: string, igUserId: string, text: string, send: () => Promise<T>, db?: OutboundTable): Promise<T> {
  const t = db ?? (await table());
  const id = await t
    .create({ data: { workspaceId, igUserId, hash: textHash(text) } })
    .then((r) => r.id)
    .catch(() => null);
  try {
    return await send();
  } catch (err) {
    if (id) await t.deleteMany({ where: { id } }).catch(() => {});
    throw err;
  }
}
