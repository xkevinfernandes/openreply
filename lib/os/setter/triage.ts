// J's triage (spec item 7): is this person sales or personal? One Haiku call
// per contact, through the same drafter seam and backend selection as drafts
// (claude_cli locally, Anthropic API with a key, the fake otherwise).
//
// J only suggests. The contact stays UNSORTED with kindSource "triage" until a
// person taps Confirm. For a PERSONAL contact the same fields carry the
// "Move to Sales?" flag when a new message looks like a question about the
// offer. J never drafts for them either way (service.ts gates on SALES).

import type { ContactKind } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { mockContact, osMockEnabled, updateMockContact } from "@/lib/os/mock";
import { getSetterConfig } from "@/lib/os/setter/config";
import { draft as runDrafter, DraftError } from "@/lib/os/setter/drafter";
import type { ThreadMessage } from "@/lib/os/setter/state";
import { setterStore } from "@/lib/os/setter/store";

export interface TriageContact {
  id: string;
  workspaceId: string;
  igUserId: string;
  username: string | null;
  conversationId: string | null;
  kind: ContactKind;
  tags: string[];
  triagedMessageId: string | null;
}

export interface TriageUpdate {
  suggestedKind?: ContactKind | null;
  suggestedReason?: string | null;
  kindSource?: string;
  triagedAt: Date;
  triagedMessageId: string | null;
}

export interface TriageStore {
  getContact(contactId: string, workspaceId?: string): Promise<TriageContact | null>;
  readThread(contact: TriageContact): Promise<ThreadMessage[]>;
  /** Writes only while the contact is still `kind` (a user's choice wins). */
  save(contactId: string, kind: ContactKind, update: TriageUpdate): Promise<void>;
}

export type TriageResult =
  | { status: "suggested"; kind: "SALES" | "PERSONAL"; reason: string }
  /** Personal contact, nothing in the new messages looks like sales. */
  | { status: "clear" }
  | { status: "skipped"; reason: string };

// ---------------------------------------------------------------- prompt
export const TRIAGE_SYSTEM = `You sort Instagram DM threads for Kevin (@claudepreneur), who sells AI and automation coaching and consulting to creators and business owners.

Decide whether ONE thread is SALES or PERSONAL.

sales: a possible customer. They run or are building a business or a creator account, named a goal or a problem, asked how he does or builds something, asked about his offer, coaching, price or working together, replied to his content with real interest, or opened with a plain greeting or compliment as a stranger (that is how most sales conversations start).

personal: someone Kevin knows socially (friends, family, peers chatting about life, plans, jokes), OR anyone J should not sell to: another agency, creator, VA or editor pitching him, collab or affiliate requests, bots, scams and mass outreach.

Judge the MESSAGES, never the handle: odd usernames are normal on Instagram. When a thread reads like friends talking, choose personal. When it is a stranger who could become a client, choose sales.

Reply with ONLY a JSON object, no prose:
{"kind": "sales", "why": "one short line, under 12 words"}`;

const PERSONAL_CHECK = `This contact is already marked PERSONAL (Kevin knows them). Answer "sales" ONLY if their NEW messages ask about Kevin's offer, coaching, program, price or working with him. Ordinary chat stays "personal".`;

function threadBlock(msgs: ThreadMessage[], handle: string | null, newSince: number | null): string {
  const lines = msgs.slice(-12).map((m, i, arr) => {
    const isNew = newSince != null && msgs.length - arr.length + i >= newSince;
    return `${isNew ? "NEW " : ""}${m.incoming ? "THEM" : "KEVIN"}: ${(m.text || "(attachment)").replace(/\s+/g, " ").slice(0, 300)}`;
  });
  return `THREAD (@${handle ?? "unknown"}):\n${lines.join("\n")}`;
}

export function buildTriagePrompt(msgs: ThreadMessage[], handle: string | null, mode: "unsorted" | "personal_check", newSince: number | null = null): string {
  return ["TRIAGE: kind", mode === "personal_check" ? PERSONAL_CHECK : "", threadBlock(msgs, handle, newSince)].filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------- heuristic
/** Cheap gate for a PERSONAL contact's new message: only these reach a model
 *  call. Errs wide; the triage call decides. */
const SALES_SIGNAL =
  /\b(price|pricing|prices|cost|costs|how much|rates?|coaching|coach me|mentor(ship)?|program+e?|course|cohort|offer|package|spots? (left|open)|work with you|work together|hire you|sign(ing)? up|enrol+|book (a|the) call|hop on a call|(a|quick) call\b|your (service|services|agency|setter|system)|set (this|that|it) up for me|build (this|that|one) for (me|us)|automate|automation|ai agents?|consult(ing|ation)?|invest(ment)?)\b/i;

export function looksLikeSales(texts: string[]): boolean {
  return texts.some((t) => SALES_SIGNAL.test(t));
}

// ---------------------------------------------------------------- triage
function parseVerdict(obj: unknown): { kind: "SALES" | "PERSONAL"; reason: string } | null {
  const o = (Array.isArray(obj) ? obj[0] : obj) as Record<string, unknown> | undefined;
  if (!o || typeof o !== "object") return null;
  const raw = String(o.kind ?? o.verdict ?? "").trim().toLowerCase();
  const kind = raw === "sales" || raw === "setter" ? "SALES" : raw === "personal" || raw === "not_now" ? "PERSONAL" : null;
  if (!kind) return null;
  const reason = String(o.why ?? o.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  return { kind, reason: reason || (kind === "SALES" ? "Reads like a possible client" : "Reads like a personal chat") };
}

export interface TriageOptions {
  store?: TriageStore;
  workspaceId?: string;
  /** Re-judge even when J already looked at their latest message. */
  force?: boolean;
  now?: Date;
}

export async function triageContact(contactId: string, opts: TriageOptions = {}): Promise<TriageResult> {
  const store = opts.store ?? triageStore();
  const now = opts.now ?? new Date();
  const contact = await store.getContact(contactId, opts.workspaceId);
  if (!contact) return { status: "skipped", reason: "Contact not found." };
  if (contact.kind === "SALES") return { status: "skipped", reason: "Already Sales." };

  const msgs = await store.readThread(contact);
  const lastIn = [...msgs].reverse().find((m) => m.incoming && m.text.trim());
  if (!lastIn) {
    await store.save(contact.id, contact.kind, { triagedAt: now, triagedMessageId: null });
    return { status: "skipped", reason: "Nothing from them yet." };
  }
  if (!opts.force && contact.triagedMessageId === lastIn.id) return { status: "skipped", reason: "J already looked at this message." };

  const cfg = getSetterConfig();
  const call = async (prompt: string) => {
    try {
      return parseVerdict((await runDrafter({ system: TRIAGE_SYSTEM, prompt, job: "triage", settings: cfg.drafter })).obj);
    } catch (err) {
      throw err instanceof DraftError ? err : new DraftError(err instanceof Error ? err.message : String(err));
    }
  };

  if (contact.kind === "PERSONAL") {
    // Only what they wrote since J last looked (or their latest turn, the
    // first time), so old history never raises the flag.
    const seen = contact.triagedMessageId ? msgs.findIndex((m) => m.id === contact.triagedMessageId) : -1;
    let from = seen + 1;
    if (seen === -1) {
      from = msgs.length;
      while (from > 0 && msgs[from - 1].incoming) from--;
    }
    const fresh = msgs.slice(from).filter((m) => m.incoming).map((m) => m.text);
    if (!looksLikeSales(fresh)) {
      await store.save(contact.id, contact.kind, { triagedAt: now, triagedMessageId: lastIn.id });
      return { status: "clear" };
    }
    const verdict = await call(buildTriagePrompt(msgs, contact.username, "personal_check", from));
    if (verdict?.kind !== "SALES") {
      await store.save(contact.id, contact.kind, { triagedAt: now, triagedMessageId: lastIn.id });
      return { status: "clear" };
    }
    await store.save(contact.id, contact.kind, { suggestedKind: "SALES", suggestedReason: verdict.reason, triagedAt: now, triagedMessageId: lastIn.id });
    return { status: "suggested", kind: "SALES", reason: verdict.reason };
  }

  const verdict = await call(buildTriagePrompt(msgs, contact.username, "unsorted"));
  if (!verdict) return { status: "skipped", reason: "J couldn't tell." };
  await store.save(contact.id, contact.kind, {
    suggestedKind: verdict.kind,
    suggestedReason: verdict.reason,
    kindSource: "triage",
    triagedAt: now,
    triagedMessageId: lastIn.id,
  });
  return { status: "suggested", kind: verdict.kind, reason: verdict.reason };
}

// ---------------------------------------------------------------- stores
const dbTriageStore: TriageStore = {
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
      tags: c.tags,
      triagedMessageId: c.triagedMessageId,
    };
  },
  async readThread(contact) {
    return setterStore().readThread({ ...contact, paused: false });
  },
  async save(contactId, kind, update) {
    // Never overwrite a kind the user set meanwhile: only write while the
    // contact is still the kind J looked at.
    const { kindSource, ...rest } = update;
    await prisma.contact.updateMany({
      where: { id: contactId, kind },
      data: { ...rest, ...(kindSource ? { kindSource } : {}) },
    });
  },
};

const mockTriageStore: TriageStore = {
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
      tags: [],
      triagedMessageId: m.contact.triagedMessageId ?? null,
    };
  },
  async readThread(contact) {
    return setterStore().readThread({ ...contact, paused: false });
  },
  async save(contactId, kind, update) {
    if (mockContact(contactId)?.contact.kind === kind) updateMockContact(contactId, update);
  },
};

export function triageStore(): TriageStore {
  return osMockEnabled() ? mockTriageStore : dbTriageStore;
}
