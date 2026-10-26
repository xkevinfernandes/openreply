// Send stamps (dm-crm issue 010). Called after every successful send: always
// moves the contact's last outbound (and last message) time later; a human
// send (Kevin's composer text or voice note, a J draft Kevin approved) also
// sets last personal send and last opened, so replying marks the thread read
// and protects the contact from the spam flag. Automated sends (keyword DMs,
// workflow steps, broadcasts, autopilot) never mark read.
//
// Stamping only writes contact timestamps after the send: it never changes
// what is sent or when, and it never throws into a send path. The setter
// record stays the one source for every send decision.
//
// Every module that calls a send endpoint stamps
// (__tests__/os/send-stamp-scan.test.ts keeps that true).

import { prisma } from "@/lib/db/client";
import { osMockEnabled } from "@/lib/os/mock";

export type StampTarget =
  /** The OS contact. */
  | { contactId: string; workspaceId?: string | null }
  /** By Instagram user id: the legacy keyword paths don't know the OS contact.
   *  instagramId = the business account's Instagram id; instagramAccountId =
   *  our InstagramAccount row id. Nothing is stamped when no contact exists yet. */
  | { igUserId: string; workspaceId?: string | null; instagramAccountId?: string | null; instagramId?: string | null };

export interface StampOptions {
  human: boolean;
  at?: Date;
}

async function contactIds(t: StampTarget): Promise<string[]> {
  if ("contactId" in t) return t.contactId ? [t.contactId] : [];
  if (!t.igUserId) return [];
  let accountIds: string[] | null = t.instagramAccountId ? [t.instagramAccountId] : null;
  if (!accountIds && t.instagramId) {
    accountIds = (await prisma.instagramAccount.findMany({ where: { instagramId: t.instagramId, ...(t.workspaceId ? { workspaceId: t.workspaceId } : {}) }, select: { id: true } })).map((a) => a.id);
    if (!accountIds.length) return [];
  }
  if (!accountIds && !t.workspaceId) return [];
  const rows = await prisma.contact.findMany({
    where: { igUserId: t.igUserId, ...(t.workspaceId ? { workspaceId: t.workspaceId } : {}), ...(accountIds ? { instagramAccountId: { in: accountIds } } : {}) },
    select: { id: true },
    take: 5,
  });
  return rows.map((r) => r.id);
}

/** Stamp a send. Returns how many contacts were stamped; never throws. */
export async function stampSend(target: StampTarget, opts: StampOptions): Promise<number> {
  const at = opts.at ?? new Date();
  try {
    if (osMockEnabled()) {
      if (!("contactId" in target)) return 0;
      const { mockCrmState, updateMockCrmState } = await import("@/lib/os/mock-crm");
      const cur = mockCrmState(target.contactId);
      const later = (v: string | null) => (v && v > at.toISOString() ? v : at.toISOString());
      updateMockCrmState(target.contactId, {
        lastOutboundAt: later(cur.lastOutboundAt),
        ...(opts.human ? { lastPersonalSendAt: later(cur.lastPersonalSendAt), lastOpenedAt: later(cur.lastOpenedAt) } : {}),
      });
      return 1;
    }
    // No database here (a unit test of a send path): nothing to stamp.
    if (!process.env.DATABASE_URL) return 0;
    const ids = await contactIds(target);
    if (!ids.length) return 0;
    const where = { id: { in: ids }, ...("workspaceId" in target && target.workspaceId ? { workspaceId: target.workspaceId } : {}) };
    // Only ever later: an older stamp (a slow retry) never moves a time back.
    const later = (field: "lastOutboundAt" | "lastMessageAt" | "lastPersonalSendAt" | "lastOpenedAt") =>
      prisma.contact.updateMany({ where: { ...where, OR: [{ [field]: null }, { [field]: { lt: at } }] }, data: { [field]: at } });
    const fields = opts.human ? (["lastOutboundAt", "lastMessageAt", "lastPersonalSendAt", "lastOpenedAt"] as const) : (["lastOutboundAt", "lastMessageAt"] as const);
    for (const f of fields) await later(f);
    return ids.length;
  } catch (err) {
    console.error("[OS Stamp] send stamp failed:", err instanceof Error ? err.message : err);
    return 0;
  }
}
