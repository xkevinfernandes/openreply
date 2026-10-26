// Where J's state and drafts live: Postgres (SetterState, Draft) or, with
// OS_MOCK=1, an in-memory copy over the sample inbox so the whole Draft →
// Approve flow can be clicked through locally.

import type { ContactKind, ContactStage, Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { getInboxAccount, sendReply } from "@/lib/os/inbox";
import { readAbTags, type AbTag } from "@/lib/os/experiments/types";
import { isBookingPayload, type BookingPayload } from "@/lib/os/integrations/calendar/types";
import { MAYA, MAYA_DRAFT, mockContact, mockContactExtras, mockMessages, osMockEnabled } from "@/lib/os/mock";
import { newRecord, type SetterRecord, type ThreadMessage } from "@/lib/os/setter/state";
import { readSetterThread } from "@/lib/os/setter/thread";
import { voiceTranscripts } from "@/lib/os/voice/store";

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
  /** For booking: the name on the invite, an email we already have, and
   *  whether a call is on the table yet. */
  fullName?: string | null;
  email?: string | null;
  stage?: ContactStage | null;
  setterStage?: string | null;
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
  /** kind "booking": what Approve books (lib/os/setter/booking.ts). */
  booking?: BookingPayload | null;
  /** Why the last Approve failed (the booking or the send). */
  sendError?: string | null;
  /** A/B lines this draft carries (lib/os/experiments). */
  abVariants?: AbTag[] | null;
  /** The knowledge base that wrote it (its voice bank plays on Approve). */
  setterId?: string | null;
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
  booking?: BookingPayload | null;
  abVariants?: AbTag[] | null;
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
    booking: isBookingPayload(d.booking) ? d.booking : null,
    sendError: d.sendError,
    abVariants: d.abVariants ? readAbTags(d.abVariants) : null,
    setterId: d.setterId,
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
      fullName: c.fullName,
      email: c.email,
      stage: c.stage,
      setterStage: c.setterStage,
    };
  },
  async readThread(contact) {
    const account = await getInboxAccount(contact.workspaceId);
    if (!account) throw new Error("Instagram account not connected.");
    if (!contact.conversationId) throw new Error("No conversation recorded for this contact yet. Open it in the Inbox once.");
    const [msgs, voice] = await Promise.all([
      readSetterThread(account, contact.conversationId),
      voiceTranscripts(contact.workspaceId, contact.conversationId).catch(() => new Map<string, string>()),
    ]);
    // Our voice notes read as the line said, not "[audio attachment]".
    return voice.size ? msgs.map((m) => (voice.has(m.id) ? { ...m, text: voice.get(m.id)!, attachment: null } : m)) : msgs;
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
          booking: input.booking ? (JSON.parse(JSON.stringify(input.booking)) as Prisma.InputJsonValue) : undefined,
          abVariants: input.abVariants?.length ? (input.abVariants as unknown as Prisma.InputJsonValue) : undefined,
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
    await sendReply(contact.workspaceId, contact.igUserId, text, { humanAgent, conversationId: contact.conversationId, source: "setter" });
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
  // Maya's draft from the InboxA board, so the composer shows it on first load.
  drafts: new Map([["mock-draft-maya", mayaMockDraft()]]),
  seq: 0,
});

function mayaMockDraft(): DraftView {
  return {
    id: "mock-draft-maya",
    contactId: MAYA.contactId,
    kind: "reply",
    anchor: "m1-r13",
    bubbles: MAYA_DRAFT.bubbles,
    status: "PENDING",
    reasoning: MAYA_DRAFT.reasoning,
    setterStage: MAYA_DRAFT.setterStage,
    humanAgent: false,
    flags: [],
    backend: "fake",
    createdAt: new Date().toISOString(),
    booking: null,
    abVariants: null,
    setterId: null,
  };
}

// Draft.raw for mock drafts (the Inspect drawer reads the trace from it).
const mockRaws = ((globalThis as { __osSetterMockRaw?: Map<string, unknown> }).__osSetterMockRaw ??= new Map());

/** OS_MOCK: what a mock draft would have stored as Draft.raw. */
export function mockDraftRaw(draftId: string): unknown {
  return mockRaws.get(draftId) ?? null;
}

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
      fullName: m.fullName ?? null,
      email: mockContactExtras(contactId).email,
      stage: m.contact.stage,
      setterStage: m.contact.setterStage,
    };
  },
  async readThread(contact) {
    return mockMessages(contact.conversationId ?? "").map((m) => ({
      id: m.id,
      text: m.text,
      incoming: !m.fromMe,
      at: (m.createdTime ?? "").replace(/\.\d{3}Z$/, "Z"),
      attachment: m.attachment ?? null,
      ...(m.voice ? { text: m.voice.transcript ? `[voice note] ${m.voice.transcript}` : "[voice note]" } : {}),
    }));
  },
  async loadState(contactId) {
    const saved = mem.states.get(contactId);
    if (saved) return saved;
    // Seeded mock drafts (Maya) have no record yet: their last message decides the window.
    const m = mockContact(contactId);
    const last = m ? mockMessages(m.conversationId ?? "").filter((x) => !x.fromMe).at(-1)?.createdTime : null;
    return last ? { ...newRecord(m!.conversationId ?? contactId, m!.username ?? "", contactId), their_last_at: last } : null;
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
      booking: input.booking ?? null,
      abVariants: input.abVariants ?? null,
      setterId: input.setterId ?? null,
    };
    mem.drafts.set(d.id, d);
    mockRaws.set(d.id, input.raw);
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
  async releaseDraft(draftId, error) {
    const d = mem.drafts.get(draftId);
    if (d) Object.assign(d, { status: "PENDING", sendError: error });
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
    await sendReply(contact.workspaceId, contact.igUserId, text, { humanAgent, conversationId: contact.conversationId, source: "setter" });
  },
  async setSetterStage(contactId, stage) {
    const m = mockContact(contactId);
    if (m) m.contact.setterStage = stage;
  },
};

export function setterStore(): SetterStore {
  return osMockEnabled() ? mockStore : dbStore;
}
