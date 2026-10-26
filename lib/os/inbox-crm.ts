// Writes for the inbox's CRM fields (dm-crm issues 009, 011, 012, 014): the
// inbound ingest (last inbound, un-archive, spam check), opening a thread,
// Mark unread, star, archive and Kevin's sticky spam override. Every write is
// workspace-scoped (updateMany), so a foreign id is a silent no-op. OS_MOCK=1
// writes the sample state in lib/os/mock-crm.ts instead.
//
// Send stamps (last outbound, last personal send) live in lib/os/send-stamp.ts.
// None of this changes what is sent or when.

import { prisma } from "@/lib/db/client";
import { osMockEnabled } from "@/lib/os/mock";
import { shouldFlagSpam } from "@/lib/os/spam";

export interface InboundInput {
  workspaceId: string;
  contactId: string;
  /** Their message text (null for a button tap). */
  text?: string | null;
  at?: Date;
}

export interface InboundState {
  kind: string | null;
  lastInboundAt: Date | null;
  lastMessageAt: Date | null;
  lastPersonalSendAt: Date | null;
  spam: boolean;
  spamOverride: boolean | null;
  archivedAt: Date | null;
}

export interface InboundPatch {
  lastInboundAt?: Date;
  lastMessageAt?: Date;
  archivedAt?: null;
  spam?: true;
}

/** Pure: what one inbound message changes. Times only move later; a new
 *  inbound un-archives; the spam heuristic may set the flag. */
export function inboundPatch(cur: InboundState, input: { text?: string | null; at: Date }): InboundPatch {
  const p: InboundPatch = {};
  const at = input.at;
  if (!cur.lastInboundAt || cur.lastInboundAt < at) p.lastInboundAt = at;
  if (!cur.lastMessageAt || cur.lastMessageAt < at) p.lastMessageAt = at;
  if (cur.archivedAt) p.archivedAt = null;
  if (shouldFlagSpam(cur, input.text)) p.spam = true;
  return p;
}

/**
 * The inbound webhook's write (Zernio message-received, through
 * lib/os/setter/queue.ts queueSetterForInbound). Never throws.
 */
export async function recordInbound(input: InboundInput): Promise<InboundPatch> {
  const at = input.at ?? new Date();
  try {
    if (osMockEnabled()) {
      const { mockCrmState } = await import("@/lib/os/mock-crm");
      const { mockContact } = await import("@/lib/os/mock");
      const s = mockCrmState(input.contactId);
      const d = (v: string | null) => (v ? new Date(v) : null);
      const patch = inboundPatch(
        {
          kind: mockContact(input.contactId)?.contact.kind ?? null,
          lastInboundAt: d(s.lastInboundAt),
          lastMessageAt: null,
          lastPersonalSendAt: d(s.lastPersonalSendAt),
          spam: s.spam,
          spamOverride: s.spamOverride,
          archivedAt: d(s.archivedAt),
        },
        { text: input.text, at }
      );
      if (patch.lastInboundAt) s.lastInboundAt = patch.lastInboundAt.toISOString();
      if (patch.archivedAt === null) s.archivedAt = null;
      if (patch.spam) s.spam = true;
      return patch;
    }
    if (!process.env.DATABASE_URL) return {};
    const cur = await prisma.contact.findFirst({
      where: { id: input.contactId, workspaceId: input.workspaceId },
      select: { kind: true, lastInboundAt: true, lastMessageAt: true, lastPersonalSendAt: true, spam: true, spamOverride: true, archivedAt: true },
    });
    if (!cur) return {};
    const patch = inboundPatch(cur, { text: input.text, at });
    if (!Object.keys(patch).length) return patch;
    // Re-check "only later" in the write itself (two webhooks at once).
    const { lastInboundAt, lastMessageAt, ...rest } = patch;
    const where = { id: input.contactId, workspaceId: input.workspaceId };
    if (lastInboundAt) await prisma.contact.updateMany({ where: { ...where, OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: lastInboundAt } }] }, data: { lastInboundAt } });
    if (lastMessageAt) await prisma.contact.updateMany({ where: { ...where, OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: lastMessageAt } }] }, data: { lastMessageAt } });
    // The spam flag is only set while there is no override (sticky).
    if (rest.spam) await prisma.contact.updateMany({ where: { ...where, spamOverride: null }, data: { spam: true } });
    if (rest.archivedAt === null) await prisma.contact.updateMany({ where, data: { archivedAt: null } });
    return patch;
  } catch (err) {
    console.error("[OS Inbox] inbound record failed:", err instanceof Error ? err.message : err);
    return {};
  }
}

// --- Kevin's actions ------------------------------------------------------------

const cleanIds = (ids: string[]) => [...new Set(ids.filter((x) => typeof x === "string" && x))].slice(0, 500);

type MockPatch = Partial<import("@/lib/os/mock-crm").MockCrmState>;

async function writeMany(workspaceId: string, ids: string[], data: Record<string, unknown>, mock: MockPatch): Promise<number> {
  const list = cleanIds(ids);
  if (!list.length) return 0;
  if (osMockEnabled()) {
    const { mockCrmState } = await import("@/lib/os/mock-crm");
    // Assign directly so null clears a field.
    for (const id of list) Object.assign(mockCrmState(id), mock);
    return list.length;
  }
  const r = await prisma.contact.updateMany({ where: { id: { in: list }, workspaceId }, data });
  return r.count;
}

/** Opening a thread marks it read. */
export function markOpened(workspaceId: string, contactId: string, at = new Date()) {
  return writeMany(workspaceId, [contactId], { lastOpenedAt: at }, { lastOpenedAt: at.toISOString() });
}

/** Mark unread: clears last opened. */
export function markUnread(workspaceId: string, ids: string[]) {
  return writeMany(workspaceId, ids, { lastOpenedAt: null }, { lastOpenedAt: null });
}

export function setStarred(workspaceId: string, ids: string[], starred: boolean) {
  return writeMany(workspaceId, ids, { starred }, { starred });
}

/** Archive (archived at = now) or restore (cleared). */
export function setArchived(workspaceId: string, ids: string[], archived: boolean, at = new Date()) {
  const v = archived ? at : null;
  return writeMany(workspaceId, ids, { archivedAt: v }, { archivedAt: v ? v.toISOString() : null });
}

/** Kevin's "Mark spam" (true) / "Not spam" (false): sticky, the heuristic
 *  never changes it again. */
export function setSpamOverride(workspaceId: string, ids: string[], spam: boolean) {
  return writeMany(workspaceId, ids, { spamOverride: spam }, { spamOverride: spam });
}
