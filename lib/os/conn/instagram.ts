// Instagram disconnect, done properly: unsubscribe our webhook at Meta (own
// Meta app accounts), delete the token, and log it. Instagram Login has no
// token revoke for apps; the person removes the app in Instagram's settings.
// Zernio accounts have no Meta token here: Zernio holds that connection.
import { prisma } from "@/lib/db/client";
import { unsubscribeInstagramAccountFromWebhooks } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { cleanNote } from "./catalog";
import { recordDisconnect } from "./audit";

export interface InstagramDisconnectResult {
  removed: number;
  /** The webhook unsubscribe Meta refused (the token is deleted anyway). */
  revokeError: string | null;
}

type Unsubscribe = (instagramId: string, token: string) => Promise<unknown>;

export async function disconnectInstagram(
  workspaceId: string,
  opts: { accountId?: string | null; actorId?: string | null; unsubscribe?: Unsubscribe } = {}
): Promise<InstagramDisconnectResult> {
  const unsubscribe = opts.unsubscribe ?? unsubscribeInstagramAccountFromWebhooks;
  const rows = await prisma.instagramAccount.findMany({
    where: { workspaceId, ...(opts.accountId ? { id: opts.accountId } : {}) },
    select: { id: true, instagramId: true, provider: true, accessToken: true, username: true },
  });
  const errors: string[] = [];
  for (const row of rows) {
    if (row.provider !== "META" || !row.accessToken) continue;
    try {
      await unsubscribe(row.instagramId, decryptToken(row.accessToken));
    } catch (err) {
      errors.push(cleanNote(err) ?? "Meta refused the webhook unsubscribe.");
    }
  }
  const { count } = await prisma.instagramAccount.deleteMany({
    where: { workspaceId, ...(opts.accountId ? { id: opts.accountId } : {}) },
  });
  const revokeError = errors.length ? errors.join("; ") : null;
  if (count) {
    await recordDisconnect(workspaceId, "instagram", {
      actorId: opts.actorId,
      revokeError,
      note: rows.map((r) => `@${r.username}`).join(", "),
    });
  }
  return { removed: count, revokeError };
}
