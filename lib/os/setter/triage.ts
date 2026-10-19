// J's triage (spec item 7): is this person sales or personal? One call per
// contact, on one of three backends (OS_TRIAGE, see resolveTriageBackend):
//   jev   one Jev decision (lib/os/setter/jev.ts): a typed sales/personal
//         choice with a calibrated probability. Below OS_TRIAGE_JEV_MIN the
//         contact is left unsuggested and shown as "J isn't sure".
//   llm   one Haiku call through the drafter seam and its backend selection
//         (claude_cli locally, Anthropic API with a key, the fake otherwise).
//   fake  the llm path forced onto the drafter's canned fake.
//
// J only suggests sales/personal. The contact stays UNSORTED with kindSource
// "triage" until a person taps Confirm. Pitches (people selling to Kevin, and
// other creators' automations) move straight to PITCHES: J never drafts
// there either, so nothing is lost, and Kevin can move them back. A pitch is
// found by the rubric (a third option for Jev and the LLM) plus a "who wrote
// first" check (pitchCheck) that needs no model call. For a PERSONAL contact the same fields carry the
// "Move to Sales?" flag when a new message looks like a question about the
// offer. J never drafts for them either way (service.ts gates on SALES).

import type { ContactKind } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { mockContact, osMockEnabled, updateMockContact } from "@/lib/os/mock";
import { getSetterConfig, resolveBackend } from "@/lib/os/setter/config";
import { draft as runDrafter, DraftError } from "@/lib/os/setter/drafter";
import { ask as askJev, jevConfigured, JevError, readChoice, readNoul, type AskOptions, type JevQuestion } from "@/lib/os/setter/jev";
import { jevReason, parseJevReason, TRIAGE_DISABLED_NOTICE } from "@/lib/os/triage-copy";
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
  /** The backend behind the stored judgment (null on rows from before it was kept). */
  suggestedBy?: string | null;
  suggestedReason?: string | null;
}

export interface TriageUpdate {
  /** Set only for PITCHES (sales/personal stay suggestions). */
  kind?: ContactKind;
  suggestedKind?: ContactKind | null;
  suggestedReason?: string | null;
  /** Jev's probability; null from the LLM backend. */
  suggestedConfidence?: number | null;
  /** The backend that made this judgment. */
  suggestedBy?: JudgingBackend | null;
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
  /** Moved to Pitches (applied, not just suggested). */
  | { status: "pitch"; kind: "PITCHES"; reason: string; confidence?: number }
  /** Jev looked but was below OS_TRIAGE_JEV_MIN: no suggestion, "J isn't sure". */
  | { status: "unsure"; lean: "SALES" | "PERSONAL"; confidence: number; reason: string }
  /** Personal contact, nothing in the new messages looks like sales. */
  | { status: "clear" }
  | { status: "skipped"; reason: string };

// ---------------------------------------------------------------- prompt
export const TRIAGE_SYSTEM = `You sort Instagram DM threads for Kevin (@claudepreneur), who sells AI and automation coaching and consulting to creators and business owners.

Decide whether ONE thread is SALES, PERSONAL or PITCH.

sales: a possible customer. They run or are building a business or a creator account, named a goal or a problem, asked how he does or builds something, asked about his offer, coaching, price or working together, replied to his content with real interest, or opened with a plain greeting or compliment as a stranger (that is how most sales conversations start).

personal: someone Kevin knows socially (friends, family, peers chatting about life, plans, jokes).

pitch: someone selling TO Kevin. Another creator's automation answering him (button cards, freebies, links to their own offer or course, often seconds after Kevin typed their keyword), an agency, freelancer, VA, editor or vendor pitching their services, collab, sponsorship or affiliate requests, bots, scams and mass outreach.

Judge the MESSAGES, never the handle: odd usernames are normal on Instagram. When a thread reads like friends talking, choose personal. When THEM is selling or their messages are automated, choose pitch. When it is a stranger who could become a client, choose sales.

Reply with ONLY a JSON object, no prose:
{"kind": "sales", "why": "one short line, under 12 words"}  (kind: sales | personal | pitch)`;

const PERSONAL_CHECK = `This contact is already marked PERSONAL (Kevin knows them). Answer "sales" ONLY if their NEW messages ask about Kevin's offer, coaching, program, price or working with him. Ordinary chat stays "personal".`;

function threadBlock(msgs: ThreadMessage[], handle: string | null, newSince: number | null): string {
  // The opening messages decide who wrote first; the latest decide the rest.
  const head = msgs.length > 14 ? msgs.slice(0, 2) : [];
  const tail = msgs.slice(-12);
  const line = (m: ThreadMessage, idx: number) => {
    const isNew = newSince != null && idx >= newSince;
    return `${isNew ? "NEW " : ""}${m.incoming ? "THEM" : "KEVIN"}${m.card ? " (card)" : ""}: ${(m.text || "(attachment)").replace(/\s+/g, " ").slice(0, 300)}`;
  };
  const lines = [...head.map((m, i) => line(m, i)), ...(head.length ? ["…"] : []), ...tail.map((m, i) => line(m, msgs.length - tail.length + i))];
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
/** "disabled": production with neither Jev nor a real LLM, so triage would
 *  only produce the drafter's canned "(sample)" verdicts. It writes nothing. */
export type TriageBackend = "jev" | "llm" | "fake" | "disabled";

export { TRIAGE_DISABLED_NOTICE };

/**
 * Which backend judges. OS_TRIAGE wins when set (jev | llm | fake).
 * Otherwise Jev when its key is set (OPENROUTER_API_KEY, or TYPESAFE_API_KEY
 * under JEV_PROVIDER=typesafe), else the LLM path. A test run never reaches
 * the network unless it asks for jev explicitly.
 *
 * In production the fake never judges: a forced fake, or the LLM path when
 * the drafter would fall back to its fake (no Anthropic key), is "disabled".
 */
export function resolveTriageBackend(env: Record<string, string | undefined> = process.env): TriageBackend {
  const forced = env.OS_TRIAGE?.trim().toLowerCase();
  const prod = env.NODE_ENV === "production";
  if (forced === "jev") return "jev";
  if (forced === "fake") return prod ? "disabled" : "fake";
  if (forced !== "llm") {
    if (env.VITEST && !prod) return "llm";
    if (jevConfigured(env)) return "jev";
  }
  if (prod && resolveBackend(env as NodeJS.ProcessEnv) === "fake") return "disabled";
  return "llm";
}

export type JudgingBackend = Exclude<TriageBackend, "disabled">;

const BACKEND_RANK: Record<JudgingBackend, number> = { fake: 0, llm: 1, jev: 2 };

/** Who made a stored judgment. Rows from before suggestedBy was kept are
 *  read from their reason line: "(sample)" is the fake, "Jev 0.86 · …" is
 *  Jev, any other reason the LLM, and no reason at all is unknown (null). */
export function storedBackend(c: Pick<TriageContact, "suggestedBy" | "suggestedReason">): JudgingBackend | null {
  const by = c.suggestedBy;
  if (by === "fake" || by === "llm" || by === "jev") return by;
  const reason = c.suggestedReason ?? "";
  if (!reason) return null;
  if (reason.includes("(sample)")) return "fake";
  return parseJevReason(reason) ? "jev" : "llm";
}

/** A manual sort re-judges a contact whose judgment came from a weaker
 *  backend than the current one: the fake always, unknown always, never a
 *  stronger one (a Jev verdict is not replaced by the LLM). */
export function judgedByWeaker(c: Pick<TriageContact, "suggestedBy" | "suggestedReason">, current: JudgingBackend): boolean {
  const by = storedBackend(c);
  if (by == null || by === "fake") return true;
  return BACKEND_RANK[by] < BACKEND_RANK[current];
}

export function triageDisabled(env: Record<string, string | undefined> = process.env): boolean {
  return resolveTriageBackend(env) === "disabled";
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
    personal: "Someone Kevin knows: friends, family or peers chatting about life, plans and jokes.",
    pitch:
      "Someone selling to Kevin: another creator's automation answering him (button cards, freebies, links to their own course, offer or community, often seconds after Kevin typed their keyword); an agency, freelancer, VA, editor or vendor pitching their services; collab, sponsorship, affiliate or shoutout requests; spam, bots, scams and mass outreach.",
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

// ---------------------------------------------------------------- pitches
/** Vendors and growth spam pitching Kevin. */
const PITCH_SIGNAL =
  /\b(collab(oration)?|promot(e|ion)|shout ?out|sponsor(ship)?|partnership|grow your (page|account|following)|\d+x your|more followers|we help|our (agency|team|services)|i can help you (grow|scale|get)|book (a|your) (free )?(call|strategy call|audit)|free (audit|strategy call)|my (course|program|community|newsletter|free guide)|grab (it|the guide|your copy)|here'?s (the|your) (link|guide|free))\b/i;

/** Entry paths that mean they came in through Kevin's own funnel. */
const OUR_FUNNEL = new Set(["comment", "keyword_dm", "story_reply", "setter_comment"]);
const LINK = /https?:\/\//i;
/** An automation answers within this long of Kevin's first message. */
const AUTOMATION_GAP_MS = 120_000;

export interface PitchCheck {
  /** Reads like someone selling to Kevin. */
  pitch: boolean;
  /** Certain enough to move without a model call. */
  strong: boolean;
  reason: string | null;
  /** Who wrote the first message. */
  firstFrom: "them" | "kevin" | null;
}

const ms = (at: string | null | undefined) => (at ? Date.parse(at) : NaN);

/**
 * The "who wrote first" check. Leads come through Kevin's funnel (comment,
 * keyword, story reply) and his opener or their reply comes first. A pitch:
 * - their side sends a button card (another creator's automation), or
 * - Kevin wrote first with a word or two (their keyword) and a link or card
 *   came back within two minutes (their automation answering him), or
 * - they wrote first, cold, and it reads like a pitch.
 */
export function pitchCheck(msgs: ThreadMessage[], entryPath?: string | null): PitchCheck {
  const first = msgs[0];
  const firstFrom = first ? (first.incoming ? "them" : "kevin") : null;
  const none: PitchCheck = { pitch: false, strong: false, reason: null, firstFrom };
  if (!first) return none;
  const theirs = msgs.filter((m) => m.incoming);

  if (theirs.some((m) => m.card)) return { pitch: true, strong: true, reason: "their automation sent a card", firstFrom };
  if (entryPath && OUR_FUNNEL.has(entryPath)) return none;

  if (firstFrom === "kevin") {
    const words = first.text.trim().split(/\s+/).filter(Boolean);
    const reply = theirs[0];
    const fast = reply && ms(reply.at) - ms(first.at) <= AUTOMATION_GAP_MS && ms(reply.at) >= ms(first.at);
    if (words.length && words.length <= 2 && !first.text.includes("?") && reply && fast && (LINK.test(reply.text) || reply.card)) {
      return { pitch: true, strong: true, reason: "you typed their keyword, their automation answered", firstFrom };
    }
    return none;
  }

  // They wrote first: a cold opener selling something.
  const opening: string[] = [];
  for (const m of msgs) {
    if (!m.incoming) break;
    opening.push(m.text);
  }
  if (opening.some((t) => PITCH_SIGNAL.test(t))) return { pitch: true, strong: false, reason: "wrote first with a pitch", firstFrom };
  return none;
}

// ---------------------------------------------------------------- reason hint

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
function parseVerdict(obj: unknown): { kind: "SALES" | "PERSONAL" | "PITCHES"; reason: string } | null {
  const o = (Array.isArray(obj) ? obj[0] : obj) as Record<string, unknown> | undefined;
  if (!o || typeof o !== "object") return null;
  const raw = String(o.kind ?? o.verdict ?? "").trim().toLowerCase();
  const kind =
    raw === "sales" || raw === "setter"
      ? "SALES"
      : raw === "personal" || raw === "not_now"
        ? "PERSONAL"
        : raw === "pitch" || raw === "pitches"
          ? "PITCHES"
          : null;
  if (!kind) return null;
  const reason = String(o.why ?? o.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const fallback = kind === "SALES" ? "Reads like a possible client" : kind === "PITCHES" ? "Selling to you" : "Reads like a personal chat";
  return { kind, reason: reason || fallback };
}

export interface TriageOptions {
  store?: TriageStore;
  workspaceId?: string;
  /** Re-judge even when J already looked at their latest message. */
  force?: boolean;
  /** A person asked ("Sort with J"): re-judge their latest message when the
   *  stored judgment came from a weaker backend (judgedByWeaker). */
  manual?: boolean;
  now?: Date;
  /** Override OS_TRIAGE / the default selection. */
  backend?: TriageBackend;
  /** Override OS_TRIAGE_JEV_MIN. */
  jevMin?: number;
  /** Transport options for the Jev call (tests swap fetch here). */
  jev?: AskOptions;
}

export async function triageContact(contactId: string, opts: TriageOptions = {}): Promise<TriageResult> {
  const backend = opts.backend ?? resolveTriageBackend();
  // Never write a fake verdict where a person could take it for J's, and
  // don't spend a thread read on a call that can't happen.
  if (backend === "disabled") return { status: "skipped", reason: TRIAGE_DISABLED_NOTICE };
  const store = opts.store ?? triageStore();
  const now = opts.now ?? new Date();
  const contact = await store.getContact(contactId, opts.workspaceId);
  if (!contact) return { status: "skipped", reason: "Contact not found." };
  if (contact.kind === "SALES") return { status: "skipped", reason: "Already Sales." };
  if (contact.kind === "PITCHES") return { status: "skipped", reason: "Already in Pitches." };

  const msgs = await store.readThread(contact);
  const lastIn = [...msgs].reverse().find((m) => m.incoming && m.text.trim());
  if (!lastIn) {
    await store.save(contact.id, contact.kind, { triagedAt: now, triagedMessageId: null });
    return { status: "skipped", reason: "Nothing from them yet." };
  }
  const rejudge = opts.force || (opts.manual && judgedByWeaker(contact, backend));
  if (!rejudge && contact.triagedMessageId === lastIn.id) return { status: "skipped", reason: "J already looked at this message." };

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
    // A re-judge reads their latest turn again, as on the first look.
    const seen = contact.triagedMessageId && !rejudge ? msgs.findIndex((m) => m.id === contact.triagedMessageId) : -1;
    let from = seen + 1;
    if (seen === -1) {
      from = msgs.length;
      while (from > 0 && msgs[from - 1].incoming) from--;
    }
    const fresh = msgs.slice(from).filter((m) => m.incoming).map((m) => m.text);
    const clear = async (): Promise<TriageResult> => {
      // A standing "Move to Sales?" flag stays (and keeps its backend); with
      // none, record who looked so a manual sort knows whether to look again.
      await store.save(contact.id, contact.kind, { ...(contact.suggestedReason ? {} : { suggestedBy: backend }), triagedAt: now, triagedMessageId: lastIn.id });
      return { status: "clear" };
    };
    // The cheap gate runs before either backend, so ordinary chat costs nothing.
    if (!looksLikeSales(fresh)) return clear();

    if (backend === "jev") {
      const answers = await jev(buildJevState(msgs, contact.username, contact.entryPath, from), { sales_enquiry: SALES_ENQUIRY_QUESTION });
      const p = readNoul(answers.sales_enquiry);
      if (p == null || p < min) return clear();
      const reason = jevReason(p, "sales", { hint: triageHint(fresh, "sales") });
      await store.save(contact.id, contact.kind, { suggestedKind: "SALES", suggestedReason: reason, suggestedConfidence: p, suggestedBy: backend, triagedAt: now, triagedMessageId: lastIn.id });
      return { status: "suggested", kind: "SALES", reason, confidence: p };
    }

    const verdict = await call(buildTriagePrompt(msgs, contact.username, "personal_check", from));
    if (verdict?.kind !== "SALES") return clear();
    await store.save(contact.id, contact.kind, { suggestedKind: "SALES", suggestedReason: verdict.reason, suggestedConfidence: null, suggestedBy: backend, triagedAt: now, triagedMessageId: lastIn.id });
    return { status: "suggested", kind: "SALES", reason: verdict.reason };
  }

  // Unsorted. Who wrote first can settle it without a model call.
  const check = pitchCheck(msgs, contact.entryPath);
  const toPitches = async (reason: string, confidence: number | null): Promise<TriageResult> => {
    await store.save(contact.id, contact.kind, {
      kind: "PITCHES",
      suggestedKind: null,
      suggestedReason: reason,
      suggestedConfidence: confidence,
      suggestedBy: backend,
      kindSource: "triage",
      triagedAt: now,
      triagedMessageId: lastIn.id,
    });
    return { status: "pitch", kind: "PITCHES", reason, ...(confidence != null ? { confidence } : {}) };
  };
  if (check.strong) return toPitches(`Pitch · ${check.reason}`, null);

  if (backend === "jev") {
    const answers = await jev(buildJevState(msgs, contact.username, contact.entryPath), { kind: KIND_QUESTION });
    const pick = readChoice(answers.kind, ["sales", "personal", "pitch"]);
    if (!pick) return { status: "skipped", reason: "J couldn't tell." };
    if (pick.choice === "pitch" && pick.probability >= min) return toPitches(`Jev ${pick.probability.toFixed(2)} · pitch${check.reason ? ` · ${check.reason}` : ""}`, pick.probability);
    if (check.pitch && pick.choice !== "personal") return toPitches(`Pitch · ${check.reason}`, null);
    // A pitch below the floor reads as "not a lead": the closer of the two others.
    const lean = (pick.choice === "pitch" ? "personal" : pick.choice) as "sales" | "personal";
    const kind = lean === "sales" ? "SALES" : "PERSONAL";
    const theirs = msgs.filter((m) => m.incoming).map((m) => m.text);
    const hint = triageHint(theirs, lean);
    const p = pick.probability;
    if (p < min) {
      // Not sure enough to suggest: no suggestion, but keep the probability
      // so the Inbox can group it under "J isn't sure".
      const reason = jevReason(p, lean, { unsure: true, hint });
      await store.save(contact.id, contact.kind, { suggestedKind: null, suggestedReason: reason, suggestedConfidence: p, suggestedBy: backend, triagedAt: now, triagedMessageId: lastIn.id });
      return { status: "unsure", lean: kind, confidence: p, reason };
    }
    const reason = jevReason(p, lean, { hint });
    await store.save(contact.id, contact.kind, {
      suggestedKind: kind,
      suggestedReason: reason,
      suggestedConfidence: p,
      suggestedBy: backend,
      kindSource: "triage",
      triagedAt: now,
      triagedMessageId: lastIn.id,
    });
    return { status: "suggested", kind, reason, confidence: p };
  }

  const verdict = await call(buildTriagePrompt(msgs, contact.username, "unsorted"));
  if (!verdict) return { status: "skipped", reason: "J couldn't tell." };
  if (verdict.kind === "PITCHES") return toPitches(verdict.reason, null);
  if (check.pitch && verdict.kind === "SALES") return toPitches(`Pitch · ${check.reason}`, null);
  await store.save(contact.id, contact.kind, {
    suggestedKind: verdict.kind,
    suggestedReason: verdict.reason,
    suggestedConfidence: null,
    suggestedBy: backend,
    kindSource: "triage",
    triagedAt: now,
    triagedMessageId: lastIn.id,
  });
  return { status: "suggested", kind: verdict.kind, reason: verdict.reason };
}

// ---------------------------------------------------------------- re-sort
export interface ResortCandidate extends TriageContact {
  kindSource: string | null;
}

export interface ResortOptions extends Omit<TriageOptions, "force" | "manual" | "store"> {
  store?: TriageStore;
  /** Candidates; default: this workspace's Unsorted and Sales contacts not set by Kevin. */
  candidates?: ResortCandidate[];
  /** Report only, write nothing. */
  dryRun?: boolean;
  /** At most this many contacts (model calls cost money). */
  limit?: number;
}

export interface ResortResult {
  looked: number;
  moved: { contactId: string; username: string | null; from: ContactKind; reason: string }[];
  errors: number;
}

/**
 * "Re-sort pitches": move people selling to Kevin out of Unsorted and Sales.
 * Unsorted contacts are judged again (force) with the pitch-aware triage.
 * Sales contacts only move on the certain who-wrote-first rule (no model
 * call), never on a guess. Kevin's own choices (kindSource "user") are kept.
 */
export async function resortPitches(workspaceId: string, opts: ResortOptions = {}): Promise<ResortResult> {
  const base = opts.store ?? triageStore();
  const writes: { contactId: string; kind: ContactKind; update: TriageUpdate }[] = [];
  const store: TriageStore = {
    getContact: (id, ws) => base.getContact(id, ws),
    readThread: (c) => base.readThread(c),
    save: async (contactId, kind, update) => {
      writes.push({ contactId, kind, update });
      if (!opts.dryRun) await base.save(contactId, kind, update);
    },
  };
  const list = (opts.candidates ?? (await resortCandidates(workspaceId))).filter((c) => c.kindSource !== "user").slice(0, opts.limit ?? 500);
  const out: ResortResult = { looked: 0, moved: [], errors: 0 };
  for (const c of list) {
    try {
      if (c.kind === "UNSORTED") {
        out.looked++;
        const r = await triageContact(c.id, { ...opts, store, workspaceId, force: true });
        if (r.status === "pitch") out.moved.push({ contactId: c.id, username: c.username, from: c.kind, reason: r.reason });
      } else if (c.kind === "SALES") {
        out.looked++;
        const msgs = await store.readThread(c);
        const check = pitchCheck(msgs, c.entryPath);
        if (!check.strong) continue;
        const reason = `Pitch · ${check.reason}`;
        const lastIn = [...msgs].reverse().find((m) => m.incoming);
        await store.save(c.id, c.kind, {
          kind: "PITCHES",
          suggestedKind: null,
          suggestedReason: reason,
          suggestedConfidence: null,
          kindSource: "triage",
          triagedAt: opts.now ?? new Date(),
          triagedMessageId: lastIn?.id ?? null,
        });
        out.moved.push({ contactId: c.id, username: c.username, from: c.kind, reason });
      }
    } catch (err) {
      out.errors++;
      console.error(`[OS Triage] re-sort ${c.id} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return out;
}

async function resortCandidates(workspaceId: string): Promise<ResortCandidate[]> {
  if (osMockEnabled()) {
    const { mockThreads } = await import("@/lib/os/mock");
    return mockThreads()
      .filter((t) => t.contact && (t.contact.kind === "UNSORTED" || t.contact.kind === "SALES"))
      .map((t) => ({
        id: t.contact!.id,
        workspaceId,
        igUserId: t.igUserId,
        username: t.username,
        conversationId: t.conversationId,
        kind: t.contact!.kind,
        tags: [],
        triagedMessageId: t.contact!.triagedMessageId ?? null,
        entryPath: t.contact!.entryPath,
        suggestedBy: t.contact!.suggestedBy ?? null,
        suggestedReason: t.contact!.suggestedReason,
        kindSource: t.contact!.kindSource ?? null,
      }));
  }
  const rows = await prisma.contact.findMany({
    where: { workspaceId, kind: { in: ["UNSORTED", "SALES"] }, zernioConversationId: { not: null }, OR: [{ kindSource: null }, { kindSource: { not: "user" } }] },
    orderBy: { lastMessageAt: "desc" },
  });
  return rows.map((c) => ({
    id: c.id,
    workspaceId: c.workspaceId,
    igUserId: c.igUserId,
    username: c.username,
    conversationId: c.zernioConversationId,
    kind: c.kind,
    tags: c.tags,
    triagedMessageId: c.triagedMessageId,
    entryPath: c.entryPath,
    suggestedBy: c.suggestedBy,
    suggestedReason: c.suggestedReason,
    kindSource: c.kindSource,
  }));
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
      suggestedBy: c.suggestedBy,
      suggestedReason: c.suggestedReason,
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
      suggestedBy: m.contact.suggestedBy ?? null,
      suggestedReason: m.contact.suggestedReason,
    };
  },
  async readThread(contact) {
    return setterStore().readThread({ ...contact, paused: false });
  },
  async save(contactId, kind, update) {
    if (mockContact(contactId)?.contact.kind === kind) updateMockContact(contactId, update);
  },
};

// ---------------------------------------------------------------- cleanup
/** The drafter's fake writes this into every reason it makes up. */
export const SAMPLE_REASON_MARK = "(sample)";

export interface SampleCleanupDb {
  contact: {
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
}

/**
 * Clear fake "(sample)" suggestions a production deploy wrote before triage
 * was gated (spec: production never shows fake suggestions). Also forgets
 * which message J looked at, so a real backend judges them fresh. A contact
 * whose kind the user set is untouched apart from the suggestion fields.
 */
export async function clearSampleSuggestions(workspaceId: string, db: SampleCleanupDb = prisma as unknown as SampleCleanupDb): Promise<number> {
  const where = { workspaceId, suggestedReason: { contains: SAMPLE_REASON_MARK } };
  const clear = { suggestedKind: null, suggestedReason: null, suggestedConfidence: null, suggestedBy: null, triagedAt: null, triagedMessageId: null };
  // J's own guesses drop their "triage" source first (the second call would
  // no longer match them once the reason is gone).
  const guessed = await db.contact.updateMany({ where: { ...where, kindSource: "triage" }, data: { ...clear, kindSource: null } });
  const rest = await db.contact.updateMany({ where, data: clear });
  return guessed.count + rest.count;
}

const cleanedWorkspaces = ((globalThis as { __osSampleCleaned?: Set<string> }).__osSampleCleaned ??= new Set());

/** clearSampleSuggestions at most once per workspace per server process:
 *  cheap enough for a page load, and a no-op after the first. Never throws. */
export async function clearSampleSuggestionsOnce(workspaceId: string, db: SampleCleanupDb = prisma as unknown as SampleCleanupDb): Promise<number> {
  if (osMockEnabled() || cleanedWorkspaces.has(workspaceId)) return 0;
  try {
    const n = await clearSampleSuggestions(workspaceId, db);
    cleanedWorkspaces.add(workspaceId);
    if (n) console.log(`[OS Triage] cleared ${n} sample suggestions in workspace ${workspaceId}`);
    return n;
  } catch (err) {
    console.error("[OS Triage] sample cleanup failed:", err instanceof Error ? err.message : err);
    return 0;
  }
}

export function triageStore(): TriageStore {
  return osMockEnabled() ? mockTriageStore : dbTriageStore;
}
