// Where J's state and drafts live: Postgres (SetterState, Draft) or, with
// OS_MOCK=1, an in-memory copy over the sample inbox so the whole Draft →
// Approve flow can be clicked through locally.

import type { ContactKind, Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { getInboxAccount, sendReply } from "@/lib/os/inbox";
import { mockContact, mockMessages, osMockEnabled } from "@/lib/os/mock";
import type { SetterRecord, ThreadMessage } from "@/lib/os/setter/state";
import { readSetterThread } from "@/lib/os/setter/thread";

export interface SetterContact {
  id: string;
  workspaceId: string;
  igUserId: string;
  username: string | null;
  conversationId: string | null;
  kind: ContactKind;
  paused: boolean;
  tags: string[];
  /** For picking the setter (lib/os/setter/setters.ts). */
  instagramAccountId?: string | null;
  setterId?: string | null;
}

export type DraftStatusName = "PENDING" | "APPROVED" | "SENT" | "DISCARDED";

export interface DraftView {
  id: string;
  contactId: string;
  kind: string;
  anchor: string;
  bubbles: string[];
  status: DraftStatusName;
  reasoning: string | null;
  setterStage: string | null;
  humanAgent: boolean;
  flags: string[];
  backend: string | null;
  createdAt: string;
}

export interface NewDraft {
  workspaceId: string;
  contactId: string;
  kind: string;
  anchor: string;
  bubbles: string[];
  reasoning: string | null;
  setterStage: string | null;
  humanAgent: boolean;
  flags: string[];
  proposedTags: Record<string, string>;
  raw: unknown;
  backend: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  /** The knowledge base that wrote it; null = the file fallback. */
  setterId?: string | null;
}

export interface SetterStore {
  getContact(contactId: string, workspaceId?: string): Promise<SetterContact | null>;
  readThread(contact: SetterContact): Promise<ThreadMessage[]>;
  loadState(contactId: string): Promise<SetterRecord | null>;
  saveState(contact: SetterContact, rec: SetterRecord): Promise<void>;
  pendingDraft(contactId: string): Promise<DraftView | null>;
  /** Creates the draft and discards any older pending one for the contact. */
  createDraft(input: NewDraft): Promise<DraftView>;
  getDraft(draftId: string, workspaceId: string): Promise<DraftView | null>;
  /** PENDING → APPROVED, atomically. False when someone else got there first. */
  claimDraft(draftId: string): Promise<boolean>;
  markSent(draftId: string, sent: { bubbles: string[]; editedText: string | null; edited: boolean }): Promise<void>;
  releaseDraft(draftId: string, error: string): Promise<void>;
  discardDraft(draftId: string): Promise<boolean>;
  listPending(workspaceId: string): Promise<DraftView[]>;
  send(contact: SetterContact, text: string, humanAgent: boolean): Promise<void>;
  setSetterStage(contactId: string, stage: string): Promise<void>;
}

// ---------------------------------------------------------------- Postgres
type DraftRow = Prisma.DraftGetPayload<object>;

function view(d: DraftRow): DraftView {
  return {
    id: d.id,
    contactId: d.contactId,
    kind: d.kind,
    anchor: d.anchor,
    bubbles: d.bubbles,
    status: d.status,
    reasoning: d.reasoning,
    setterStage: d.setterStage,
    humanAgent: d.humanAgent,
    flags: d.flags,
    backend: d.backend,
    createdAt: d.createdAt.toISOString(),
  };
}

const dbStore: SetterStore = {
  async getContact(contactId, workspaceId) {
    const c = await prisma.contact.findFirst({ where: { id: contactId, ...(workspaceId ? { workspaceId } : {}) } });
    if (!c) return null;
    return {
      id: c.id,
      workspaceId: c.workspaceId,
      igUserId: c.igUserId,
      username: c.username,
      conversationId: c.zernioConversationId,
      kind: c.kind,
      paused: c.paused,
      tags: c.tags,
      instagramAccountId: c.instagramAccountId,
      setterId: c.setterId,
    };
  },
  async readThread(contact) {
    const account = await getInboxAccount(contact.workspaceId);
    if (!account) throw new Error("Instagram account not connected.");
    if (!contact.conversationId) throw new Error("No conversation recorded for this contact yet. Open it in the Inbox once.");
    return readSetterThread(account, contact.conversationId);
  },
  async loadState(contactId) {
    const row = await prisma.setterState.findUnique({ where: { contactId } });
    return row ? (row.record as unknown as SetterRecord) : null;
  },
  async saveState(contact, rec) {
    const data = {
      workspaceId: contact.workspaceId,
      state: rec.state,
      record: rec as unknown as Prisma.InputJsonValue,
      nextActionKind: rec.next_action.kind === "none" ? null : rec.next_action.kind,
      nextActionAt: rec.next_action.at ? new Date(rec.next_action.at) : null,
    };
    await prisma.setterState.upsert({ where: { contactId: contact.id }, create: { contactId: contact.id, ...data }, update: data });
  },
  async pendingDraft(contactId) {
    const d = await prisma.draft.findFirst({ where: { contactId, status: "PENDING" }, orderBy: { createdAt: "desc" } });
    return d ? view(d) : null;
  },
  async createDraft(input) {
    const [, d] = await prisma.$transaction([
      prisma.draft.updateMany({
        where: { contactId: input.contactId, status: "PENDING" },
        data: { status: "DISCARDED", decidedAt: new Date() },
      }),
      prisma.draft.create({
        data: {
          ...input,
          proposedTags: input.proposedTags as Prisma.InputJsonValue,
          raw: (input.raw ?? null) as Prisma.InputJsonValue,
        },
      }),
    ]);
    return view(d);
  },
  async getDraft(draftId, workspaceId) {
    const d = await prisma.draft.findFirst({ where: { id: draftId, workspaceId } });
    return d ? view(d) : null;
  },
  async claimDraft(draftId) {
    const r = await prisma.draft.updateMany({ where: { id: draftId, status: "PENDING" }, data: { status: "APPROVED", decidedAt: new Date() } });
    return r.count === 1;
  },
  async markSent(draftId, sent) {
    await prisma.draft.update({
      where: { id: draftId },
      data: { status: "SENT", sentAt: new Date(), bubbles: sent.bubbles, editedText: sent.editedText, edited: sent.edited, sendError: null },
    });
  },
  async releaseDraft(draftId, error) {
    await prisma.draft.update({ where: { id: draftId }, data: { status: "PENDING", decidedAt: null, sendError: error.slice(0, 500) } });
  },
  async discardDraft(draftId) {
    const r = await prisma.draft.updateMany({ where: { id: draftId, status: "PENDING" }, data: { status: "DISCARDED", decidedAt: new Date() } });
    return r.count === 1;
  },
  async listPending(workspaceId) {
    const rows = await prisma.draft.findMany({ where: { workspaceId, status: "PENDING" }, orderBy: { createdAt: "desc" } });
    return rows.map(view);
  },
  async send(contact, text, humanAgent) {
    await sendReply(contact.workspaceId, contact.igUserId, text, { humanAgent, conversationId: contact.conversationId });
  },
  async setSetterStage(contactId, stage) {
    await prisma.contact.update({ where: { id: contactId }, data: { setterStage: stage } });
  },
};

// ---------------------------------------------------------------- OS_MOCK
interface MockDb {
  states: Map<string, SetterRecord>;
  drafts: Map<string, DraftView>;
  seq: number;
}

const mem = ((globalThis as { __osSetterMock?: MockDb }).__osSetterMock ??= {
  states: new Map(),
  drafts: new Map(),
  seq: 0,
});

const mockStore: SetterStore = {
  async getContact(contactId, workspaceId) {
    const m = mockContact(contactId);
    if (!m) return null;
    return {
      id: contactId,
      workspaceId: workspaceId ?? "mock",
      igUserId: m.igUserId,
      username: m.username,
      conversationId: m.conversationId,
      kind: m.contact.kind,
      paused: m.contact.paused,
      tags: [],
    };
  },
  async readThread(contact) {
    return mockMessages(contact.conversationId ?? "").map((m) => ({
      id: m.id,
      text: m.text,
      incoming: !m.fromMe,
      at: (m.createdTime ?? "").replace(/\.\d{3}Z$/, "Z"),
    }));
  },
  async loadState(contactId) {
    return mem.states.get(contactId) ?? null;
  },
  async saveState(contact, rec) {
    mem.states.set(contact.id, rec);
  },
  async pendingDraft(contactId) {
    return [...mem.drafts.values()].reverse().find((d) => d.contactId === contactId && d.status === "PENDING") ?? null;
  },
  async createDraft(input) {
    for (const d of mem.drafts.values()) if (d.contactId === input.contactId && d.status === "PENDING") d.status = "DISCARDED";
    const d: DraftView = {
      id: `mock-draft-${++mem.seq}`,
      contactId: input.contactId,
      kind: input.kind,
      anchor: input.anchor,
      bubbles: input.bubbles,
      status: "PENDING",
      reasoning: input.reasoning,
      setterStage: input.setterStage,
      humanAgent: input.humanAgent,
      flags: input.flags,
      backend: input.backend,
      createdAt: new Date().toISOString(),
    };
    mem.drafts.set(d.id, d);
    return d;
  },
  async getDraft(draftId) {
    return mem.drafts.get(draftId) ?? null;
  },
  async claimDraft(draftId) {
    const d = mem.drafts.get(draftId);
    if (!d || d.status !== "PENDING") return false;
    d.status = "APPROVED";
    return true;
  },
  async markSent(draftId, sent) {
    const d = mem.drafts.get(draftId);
    if (d) Object.assign(d, { status: "SENT", bubbles: sent.bubbles });
  },
  async releaseDraft(draftId) {
    const d = mem.drafts.get(draftId);
    if (d) d.status = "PENDING";
  },
  async discardDraft(draftId) {
    const d = mem.drafts.get(draftId);
    if (!d || d.status !== "PENDING") return false;
    d.status = "DISCARDED";
    return true;
  },
  async listPending() {
    return [...mem.drafts.values()].filter((d) => d.status === "PENDING");
  },
  async send(contact, text, humanAgent) {
    await sendReply(contact.workspaceId, contact.igUserId, text, { humanAgent, conversationId: contact.conversationId });
  },
  async setSetterStage(contactId, stage) {
    const m = mockContact(contactId);
    if (m) m.contact.setterStage = stage;
  },
};

export function setterStore(): SetterStore {
  return osMockEnabled() ? mockStore : dbStore;
}
