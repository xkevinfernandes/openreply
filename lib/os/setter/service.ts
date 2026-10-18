// J's jobs: draft for a contact, approve (send) a draft, discard a draft.
// Called from the BullMQ setter worker and from Inbox server actions.
//
// Approve-only (spec item 9): nothing here sends without approveDraft, and
// approveDraft is only reachable from a person pressing Approve. The setter
// config carries an `autonomy` field for later; `auto` has no code path.

import { osMockEnabled } from "@/lib/os/mock";
import { getSetterConfig, type SetterConfig } from "@/lib/os/setter/config";
import { draft as runDrafter, DraftError } from "@/lib/os/setter/drafter";
import type { KnowledgeSource } from "@/lib/os/setter/kb";
import { loadMethod } from "@/lib/os/setter/knowledge";
import {
  bubblesOf,
  buildPrompt,
  isInvitation,
  mentionsPrice,
  missingQualifiers,
  systemPrompt,
  tagOptions,
  type DraftObject,
} from "@/lib/os/setter/prompt";
import {
  advance,
  iso,
  logEvent,
  newRecord,
  observe,
  recordSend,
  recordSkip,
  windowState,
  type SetterAction,
  type SetterRecord,
} from "@/lib/os/setter/state";
import { dbKnowledge } from "@/lib/os/setter/setters";
import { setterStore, type DraftView, type SetterContact, type SetterStore } from "@/lib/os/setter/store";

export type DraftResult =
  | { status: "drafted"; draft: DraftView }
  | { status: "existing"; draft: DraftView }
  | { status: "held"; reason: string }
  | { status: "idle"; reason: string; nextActionAt?: string | null }
  | { status: "skipped"; reason: string };

export interface DraftOptions {
  /** A person asked ("Draft with J"): draft even when no timer is due. */
  force?: boolean;
  /** Scope the contact lookup to this workspace (server actions). */
  workspaceId?: string;
  store?: SetterStore;
  /** Where the setter's knowledge comes from (default: Postgres, file fallback). */
  knowledge?: KnowledgeSource;
  now?: Date;
  /** Called with the record after every evaluation (the worker schedules timers from it). */
  onState?: (rec: SetterRecord) => Promise<void> | void;
}

function frozenBy(contact: SetterContact, cfg: SetterConfig): string | null {
  return contact.tags.find((t) => cfg.skip_tags.includes(t)) ?? null;
}

/** Spec item 7: J drafts only for sales contacts that aren't paused. */
function gate(contact: SetterContact, cfg: SetterConfig): string | null {
  if (contact.kind !== "SALES") return "J only drafts for Sales contacts. Move this one to Sales first.";
  if (contact.paused) return "J is paused for this contact.";
  const tag = frozenBy(contact, cfg);
  if (tag) return `Tagged ${tag}: J doesn't draft for them.`;
  return null;
}

/** What a manual "Draft with J" means when no timer is due: answer them if
 *  they wrote last, otherwise a gentle nudge (the model may still hold). */
function manualAction(rec: SetterRecord, msgs: { id: string; incoming: boolean }[]): SetterAction | null {
  if (rec.window.state === "closed") return null;
  const last = msgs[msgs.length - 1];
  if (!last) return null;
  return {
    kind: last.incoming ? "reply" : "nudge",
    anchor: `manual:${last.id}`,
    human_agent: rec.window.state === "human_agent",
  };
}

export async function draftForContact(contactId: string, opts: DraftOptions = {}): Promise<DraftResult> {
  const store = opts.store ?? setterStore();
  const cfg = getSetterConfig();
  const now = opts.now ?? new Date();
  const contact = await store.getContact(contactId, opts.workspaceId);
  if (!contact) return { status: "skipped", reason: "Contact not found." };
  const blocked = gate(contact, cfg);
  if (blocked) return { status: "skipped", reason: blocked };

  const setter = await (opts.knowledge ?? dbKnowledge).forContact(contact);
  const catalog = setter.catalog;
  const msgs = await store.readThread(contact);
  let rec = (await store.loadState(contact.id)) ?? newRecord(contact.conversationId ?? contact.id, contact.username ?? "", contact.id);
  rec = observe(rec, msgs, contact.tags, catalog.resources, now, cfg);
  let action: SetterAction | null;
  [rec, action] = advance(rec, now, cfg);

  const save = async () => {
    await store.saveState(contact, rec);
    await opts.onState?.(rec);
  };

  if (!action && opts.force) action = manualAction(rec, msgs);
  if (!action) {
    await save();
    const reason =
      rec.window.state === "closed"
        ? "Instagram's reply window is closed (7 days since their last message)."
        : rec.next_action.kind !== "none"
          ? `Nothing due yet: ${rec.next_action.kind.replace("_", " ")} at ${rec.next_action.at}.`
          : "Nothing to answer right now.";
    return { status: "idle", reason, nextActionAt: rec.next_action.at };
  }

  const existing = await store.pendingDraft(contact.id);
  if (existing && existing.anchor === action.anchor && !opts.force) {
    await save();
    return { status: "existing", draft: existing };
  }
  if ((rec.skipped_anchors ?? []).includes(action.anchor) && !opts.force) {
    await save();
    return { status: "held", reason: "You skipped this one already." };
  }

  const today = now.toISOString().slice(0, 10);
  const system = systemPrompt(loadMethod(), setter.profile, setter.offered, today);
  const prompt = buildPrompt(rec, msgs, action, catalog, now);
  let result;
  try {
    result = await runDrafter({ system, prompt, job: "draft", settings: cfg.drafter });
  } catch (err) {
    await save();
    throw err instanceof DraftError ? err : new DraftError(err instanceof Error ? err.message : String(err));
  }
  const obj = (result.obj && typeof result.obj === "object" ? result.obj : {}) as DraftObject;
  const bubbles = bubblesOf(obj);

  if (obj.hold || !bubbles.length) {
    // J chose silence (low-signal message, we wrote twice…). Remember the
    // anchor so it isn't re-asked until they write again. Holding is valid.
    const reason = obj.hold_reason || "no reply needed";
    rec = recordSkip(rec, action.anchor, `held:${action.kind}:${reason.slice(0, 60)}`, now);
    await save();
    return { status: "held", reason };
  }

  const allowed = new Set(tagOptions(catalog));
  const proposed = Object.fromEntries(
    Object.entries(obj.propose_tags && typeof obj.propose_tags === "object" ? obj.propose_tags : {})
      .filter(([k]) => allowed.has(k))
      .map(([k, v]) => [k, String(v)])
  );
  const invite = isInvitation(obj, rec);
  const flags: string[] = [];
  if (action.human_agent) flags.push("human_agent");
  if (invite) flags.push("invite");
  if (invite && missingQualifiers(obj.invite as Record<string, unknown>).length) flags.push("unqualified");
  if (mentionsPrice(bubbles)) flags.push("price");
  if (result.usage.backend === "fake") flags.push("sample");

  const kind = invite ? "invite" : action.kind;
  const stage = obj.stage_proposed || obj.stage || null;
  const d = await store.createDraft({
    workspaceId: contact.workspaceId,
    contactId: contact.id,
    kind,
    anchor: action.anchor,
    bubbles,
    reasoning: obj.stage_reasoning || obj.reasoning || null,
    setterStage: stage,
    humanAgent: action.human_agent,
    flags,
    proposedTags: proposed,
    raw: obj,
    backend: result.usage.backend,
    model: result.usage.model,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    setterId: setter.setterId,
  });
  const invitePayload = invite && obj.invite && typeof obj.invite === "object" ? obj.invite : null;
  rec.draft = { anchor: action.anchor, kind, draft_id: d.id, stage: stage ?? undefined, offer: (invitePayload?.offer as string) ?? null };
  rec.proposed_tags = proposed;
  if (obj.qualification?.fit_score != null) rec.fit_score = obj.qualification.fit_score;
  logEvent(rec, now, `drafted:${action.kind}`);
  await save();
  return { status: "drafted", draft: d };
}

// ---------------------------------------------------------------- approval
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Human-ish spacing between bubbles, as J does today (shorter in mock mode). */
function bubbleGap(mock: boolean): number {
  return mock ? 300 : 1200 + Math.random() * 1200;
}

export function splitBubbles(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
}

export interface ApproveOptions {
  /** The composer text when the user edited the draft first; blank lines split bubbles. */
  editedText?: string | null;
  store?: SetterStore;
  now?: () => Date;
  onState?: (rec: SetterRecord) => Promise<void> | void;
  /** Override the pause between bubbles (tests). */
  gapMs?: number;
}

export async function approveDraft(draftId: string, workspaceId: string, opts: ApproveOptions = {}): Promise<{ error?: string }> {
  const store = opts.store ?? setterStore();
  const cfg = getSetterConfig();
  const now = opts.now ?? (() => new Date());
  const d = await store.getDraft(draftId, workspaceId);
  if (!d) return { error: "That draft is gone. Refresh the page." };
  if (d.status !== "PENDING") return { error: "That draft was already handled." };
  const contact = await store.getContact(d.contactId, workspaceId);
  if (!contact) return { error: "Contact not found." };

  const edited = opts.editedText != null && opts.editedText.trim() !== d.bubbles.join("\n\n").trim();
  const bubbles = edited ? splitBubbles(opts.editedText!) : d.bubbles;
  if (!bubbles.length) return { error: "Nothing to send." };

  // The window decides the send mode at send time, not draft time.
  const prev = await store.loadState(contact.id);
  const [win] = windowState(prev?.their_last_at ?? null, now(), cfg);
  if (win === "closed") return { error: "Instagram's reply window has closed for this person. Discard the draft." };
  const humanAgent = win === "human_agent";

  if (!(await store.claimDraft(d.id))) return { error: "That draft was already handled." };
  const mock = osMockEnabled();
  let sentCount = 0;
  try {
    for (const [i, b] of bubbles.entries()) {
      if (i) await sleep(opts.gapMs ?? bubbleGap(mock));
      await store.send(contact, b, humanAgent);
      sentCount++;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "The message didn't send.";
    if (sentCount === 0) {
      await store.releaseDraft(d.id, message);
      return { error: message };
    }
    // Some bubbles are out: record what went, never resend those.
    await store.markSent(d.id, { bubbles: bubbles.slice(0, sentCount), editedText: edited ? opts.editedText! : null, edited });
    return { error: `Sent ${sentCount} of ${bubbles.length} bubbles, then: ${message}` };
  }
  await store.markSent(d.id, { bubbles, editedText: edited ? opts.editedText! : null, edited });

  let rec = prev ?? newRecord(contact.conversationId ?? contact.id, contact.username ?? "", contact.id);
  rec = recordSend(rec, d.kind, bubbles, edited, humanAgent, now());
  if (d.setterStage) {
    rec.stage = d.setterStage;
    await store.setSetterStage(contact.id, d.setterStage);
  }
  [rec] = advance(rec, now(), cfg);
  await store.saveState(contact, rec);
  await opts.onState?.(rec);
  return {};
}

/** Discard = Python's "skip": J won't redraft this anchor until they write again. */
export async function discardDraft(draftId: string, workspaceId: string, store: SetterStore = setterStore()): Promise<{ error?: string }> {
  const d = await store.getDraft(draftId, workspaceId);
  if (!d) return { error: "That draft is gone. Refresh the page." };
  if (!(await store.discardDraft(d.id))) return { error: "That draft was already handled." };
  const contact = await store.getContact(d.contactId, workspaceId);
  const prev = contact ? await store.loadState(contact.id) : null;
  if (contact && prev) await store.saveState(contact, recordSkip(prev, d.anchor, `skipped:${d.kind}`, iso(new Date())));
  return {};
}

export async function pendingDrafts(workspaceId: string, store: SetterStore = setterStore()): Promise<DraftView[]> {
  return store.listPending(workspaceId);
}
