// J's triage (spec item 7): is this person sales or personal? One call per
// contact, on one of three backends (OS_TRIAGE, see resolveTriageBackend):
//   jev   one Jev decision (lib/os/setter/jev.ts): a typed sales/personal
//         choice with a calibrated probability. Below OS_TRIAGE_JEV_MIN the
//         contact is left unsuggested and shown as "J isn't sure".
//   llm   one Haiku call through the drafter seam and its backend selection
//         (claude_cli locally, Anthropic API with a key, the fake otherwise).
//   fake  the llm path forced onto the drafter's canned fake.
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
import { ask as askJev, jevConfigured, JevError, readChoice, readNoul, type AskOptions, type JevQuestion } from "@/lib/os/setter/jev";
import { jevReason } from "@/lib/os/triage-copy";
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
  /** How they first reached us ("comment", "story_reply", ...), if known. */
  entryPath?: string | null;
}

export interface TriageUpdate {
  suggestedKind?: ContactKind | null;
  suggestedReason?: string | null;
  /** Jev's probability; null from the LLM backend. */
  suggestedConfidence?: number | null;
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
  | { status: "suggested"; kind: "SALES" | "PERSONAL"; reason: string; confidence?: number }
  /** Jev looked but was below OS_TRIAGE_JEV_MIN: no suggestion, "J isn't sure". */
  | { status: "unsure"; lean: "SALES" | "PERSONAL"; confidence: number; reason: string }
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

// ---------------------------------------------------------------- backend
export type TriageBackend = "jev" | "llm" | "fake";

/**
 * Which backend judges. OS_TRIAGE wins when set (jev | llm | fake).
 * Otherwise Jev when its key is set (OPENROUTER_API_KEY, or TYPESAFE_API_KEY
 * under JEV_PROVIDER=typesafe), else the LLM path. A test run never reaches
 * the network unless it asks for jev explicitly.
 */
export function resolveTriageBackend(env: Record<string, string | undefined> = process.env): TriageBackend {
  const forced = env.OS_TRIAGE?.trim().toLowerCase();
  if (forced === "jev" || forced === "llm" || forced === "fake") return forced;
  if (env.VITEST) return "llm";
  return jevConfigured(env) ? "jev" : "llm";
}

export const DEFAULT_JEV_MIN = 0.7;

/** The probability at or above which Jev's answer becomes a suggestion. */
export function jevMin(env: Record<string, string | undefined> = process.env): number {
  const raw = env.OS_TRIAGE_JEV_MIN?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : DEFAULT_JEV_MIN;
}

// ---------------------------------------------------------------- jev questions
const ABOUT =
  "Kevin (@claudepreneur) sells AI and automation coaching and consulting, including an AI DM setter, to creators and business owners. In the thread THEM is the contact and KEVIN is the account owner. Judge what THEM writes, never the handle.";

/** The rubrics are the only definition of sales and personal Jev ever sees. */
export const KIND_QUESTION: JevQuestion = {
  type: "choice",
  instructions: `${ABOUT} Is this a sales conversation (a possible customer) or a personal one?`,
  criteria: {
    sales:
      "A possible customer: asks about Kevin's offer, coaching, program, price, his AI setter or working together; wants business, content or automation help; names a goal or problem in their own business; replies to a lead magnet, keyword or his content with real interest; or is a stranger opening with a plain greeting or compliment.",
    personal:
      "Someone J should not sell to: friends, family or peers chatting about life, plans and jokes; an agency, freelancer, VA, editor or vendor pitching their own services to Kevin; collab, sponsorship, affiliate or shoutout requests; spam, bots, scams and mass outreach.",
  },
};

export const SALES_ENQUIRY_QUESTION: JevQuestion = {
  type: "noul",
  instructions: `${ABOUT} Kevin knows this contact personally. Do their NEW messages ask about buying from Kevin: his offer, coaching, program, price, his AI setter or working with him?`,
  criteria: {
    true: "The NEW messages ask about Kevin's offer, coaching, program, price, AI setter or working with him.",
    false: "Ordinary chat: plans, jokes, life, their own work, or anything that is not asking to buy from Kevin.",
  },
};

export function buildJevState(msgs: ThreadMessage[], handle: string | null, entryPath: string | null | undefined, newSince: number | null = null): string {
  const via = entryPath ? ` They came in via ${entryPath.replace(/_/g, " ")}.` : "";
  return `Instagram DM thread with @${handle ?? "unknown"}.${via}\n\n${threadBlock(msgs, handle, newSince)}`;
}

// ---------------------------------------------------------------- reason hint
/** Vendors and growth spam pitching Kevin. */
const PITCH_SIGNAL =
  /\b(collab(oration)?|promot(e|ion)|shout ?out|sponsor(ship)?|partnership|grow your (page|account|following)|\d+x your|more followers|we help|our (agency|team|services)|i can help you (grow|scale|get))\b/i;

/** A few words on why, from rules: Jev has no free text, and an LLM call
 *  just for the reason line is not worth it. Null when nothing matches. */
export function triageHint(texts: string[], lean: "sales" | "personal"): string | null {
  if (lean === "sales") {
    for (const t of texts) {
      const m = SALES_SIGNAL.exec(t);
      if (m) return `mentions "${m[0].toLowerCase()}"`;
    }
    return null;
  }
  return texts.some((t) => PITCH_SIGNAL.test(t)) ? "reads like a pitch" : null;
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
  /** Override OS_TRIAGE / the default selection. */
  backend?: TriageBackend;
  /** Override OS_TRIAGE_JEV_MIN. */
  jevMin?: number;
  /** Transport options for the Jev call (tests swap fetch here). */
  jev?: AskOptions;
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

  const backend = opts.backend ?? resolveTriageBackend();
  const min = opts.jevMin ?? jevMin();
  const cfg = getSetterConfig();
  const call = async (prompt: string) => {
    try {
      const r = await runDrafter({
        system: TRIAGE_SYSTEM,
        prompt,
        job: "triage",
        settings: cfg.drafter,
        ...(backend === "fake" ? { backend: "fake" as const } : {}),
      });
      return parseVerdict(r.obj);
    } catch (err) {
      throw err instanceof DraftError ? err : new DraftError(err instanceof Error ? err.message : String(err));
    }
  };
  const jev = (state: string, questions: Record<string, JevQuestion>) =>
    askJev(state, questions, opts.jev).catch((err) => {
      throw err instanceof JevError ? err : new JevError(err instanceof Error ? err.message : String(err));
    });

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
    const clear = async (): Promise<TriageResult> => {
      await store.save(contact.id, contact.kind, { triagedAt: now, triagedMessageId: lastIn.id });
      return { status: "clear" };
    };
    // The cheap gate runs before either backend, so ordinary chat costs nothing.
    if (!looksLikeSales(fresh)) return clear();

    if (backend === "jev") {
      const answers = await jev(buildJevState(msgs, contact.username, contact.entryPath, from), { sales_enquiry: SALES_ENQUIRY_QUESTION });
      const p = readNoul(answers.sales_enquiry);
      if (p == null || p < min) return clear();
      const reason = jevReason(p, "sales", { hint: triageHint(fresh, "sales") });
      await store.save(contact.id, contact.kind, { suggestedKind: "SALES", suggestedReason: reason, suggestedConfidence: p, triagedAt: now, triagedMessageId: lastIn.id });
      return { status: "suggested", kind: "SALES", reason, confidence: p };
    }

    const verdict = await call(buildTriagePrompt(msgs, contact.username, "personal_check", from));
    if (verdict?.kind !== "SALES") return clear();
    await store.save(contact.id, contact.kind, { suggestedKind: "SALES", suggestedReason: verdict.reason, suggestedConfidence: null, triagedAt: now, triagedMessageId: lastIn.id });
    return { status: "suggested", kind: "SALES", reason: verdict.reason };
  }

  if (backend === "jev") {
    const answers = await jev(buildJevState(msgs, contact.username, contact.entryPath), { kind: KIND_QUESTION });
    const pick = readChoice(answers.kind, ["sales", "personal"]);
    if (!pick) return { status: "skipped", reason: "J couldn't tell." };
    const lean = pick.choice as "sales" | "personal";
    const kind = lean === "sales" ? "SALES" : "PERSONAL";
    const theirs = msgs.filter((m) => m.incoming).map((m) => m.text);
    const hint = triageHint(theirs, lean);
    const p = pick.probability;
    if (p < min) {
      // Not sure enough to suggest: no suggestion, but keep the probability
      // so the Inbox can group it under "J isn't sure".
      const reason = jevReason(p, lean, { unsure: true, hint });
      await store.save(contact.id, contact.kind, { suggestedKind: null, suggestedReason: reason, suggestedConfidence: p, triagedAt: now, triagedMessageId: lastIn.id });
      return { status: "unsure", lean: kind, confidence: p, reason };
    }
    const reason = jevReason(p, lean, { hint });
    await store.save(contact.id, contact.kind, {
      suggestedKind: kind,
      suggestedReason: reason,
      suggestedConfidence: p,
      kindSource: "triage",
      triagedAt: now,
      triagedMessageId: lastIn.id,
    });
    return { status: "suggested", kind, reason, confidence: p };
  }

  const verdict = await call(buildTriagePrompt(msgs, contact.username, "unsorted"));
  if (!verdict) return { status: "skipped", reason: "J couldn't tell." };
  await store.save(contact.id, contact.kind, {
    suggestedKind: verdict.kind,
    suggestedReason: verdict.reason,
    suggestedConfidence: null,
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
      entryPath: c.entryPath,
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
      entryPath: m.contact.entryPath,
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
