// J's jobs: draft for a contact, approve (send) a draft, discard a draft.
// Called from the BullMQ setter worker and from Inbox server actions.
//
// Approve-only (spec item 9): nothing here sends without approveDraft, and
// approveDraft is only reachable from a person pressing Approve. The setter
// config carries an `autonomy` field for later; `auto` has no code path.

import { formatSlot } from "@/lib/os/integrations/calendar/slots";
import { CalendarApiError, type BookingPayload } from "@/lib/os/integrations/calendar/types";
import { osMockEnabled } from "@/lib/os/mock";
import {
  applyBookingReply,
  bookingBlock,
  loadBookingContext,
  readBookingReply,
  wantsCalendar,
  type BookingContext,
  type BookingDecision,
} from "@/lib/os/setter/booking";
import { bookingStore, calendarSource, type BookingRecord, type BookingStore, type CalendarSource } from "@/lib/os/setter/booking-store";
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
  /** The booking calendar and where bookings are kept (default: DB / OS_MOCK). */
  calendar?: CalendarSource;
  bookings?: BookingStore;
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
  const phaseBefore = rec.booking?.phase ?? null;
  rec = observe(rec, msgs, contact.tags, catalog.resources, now, cfg);
  if (phaseBefore !== "confirmed" && rec.booking?.phase === "confirmed") {
    // Their screenshot of the invite: the call is confirmed (Call booked, CRM sync).
    const at = rec.booking.confirmed_at ? new Date(rec.booking.confirmed_at) : now;
    await (opts.bookings ?? bookingStore())
      .confirm(contact, rec.booking.booking_id ?? null, at)
      .catch((err) => console.error("[OS Setter] could not confirm the booking:", err instanceof Error ? err.message : err));
  }
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

  // A call is on the table and a calendar is connected: J offers real times
  // and books in the DM. Without one, the old path (send the booking link).
  const extras: string[] = [];
  const preFlags: string[] = [];
  let bookingCtx: BookingContext | null = null;
  if (wantsCalendar(rec, contact)) {
    try {
      const cal = await (opts.calendar ?? calendarSource).forSetter(contact.workspaceId, setter.setterId);
      if (cal) {
        bookingCtx = await loadBookingContext(cal, rec, msgs, now);
        if (bookingCtx) extras.push(bookingBlock(bookingCtx, rec));
        else preFlags.push("calendar_off");
      }
    } catch (err) {
      console.error("[OS Setter] calendar read failed:", err instanceof Error ? err.message : err);
      preFlags.push("calendar_off");
    }
  }

  const today = now.toISOString().slice(0, 10);
  const system = systemPrompt(loadMethod(), setter.profile, setter.offered, today);
  const prompt = buildPrompt(rec, msgs, action, catalog, now, extras);
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
  const bookingReply = bookingCtx ? readBookingReply(obj.booking) : null;
  const booking: BookingDecision | null = bookingCtx ? applyBookingReply(bookingReply, bookingCtx, rec, contact, bubbles, now) : null;
  if (booking?.timezone) rec.booking = { ...(rec.booking ?? { phase: "proposed", at: iso(now)! }), timezone: booking.timezone };
  const inBooking = Boolean(bookingReply && bookingReply.action !== "none");
  const invite = !inBooking && isInvitation(obj, rec);
  const flags: string[] = [...preFlags, ...(booking?.flags ?? [])];
  if (action.human_agent) flags.push("human_agent");
  if (invite) flags.push("invite");
  if (invite && missingQualifiers(obj.invite as Record<string, unknown>).length) flags.push("unqualified");
  const finalBubbles = booking?.bubbles.length ? booking.bubbles : bubbles;
  if (mentionsPrice(finalBubbles)) flags.push("price");
  if (result.usage.backend === "fake") flags.push("sample");

  const kind = booking?.kind === "booking" ? "booking" : invite ? "invite" : action.kind;
  const stage = obj.stage_proposed || obj.stage || null;
  const d = await store.createDraft({
    workspaceId: contact.workspaceId,
    contactId: contact.id,
    kind,
    anchor: action.anchor,
    bubbles: finalBubbles,
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
    booking: booking?.payload ?? null,
  });
  const invitePayload = invite && obj.invite && typeof obj.invite === "object" ? obj.invite : null;
  rec.draft = {
    anchor: action.anchor,
    kind,
    draft_id: d.id,
    stage: stage ?? undefined,
    offer: (invitePayload?.offer as string) ?? null,
    booking: booking?.next ?? null,
  };
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
  calendar?: CalendarSource;
  bookings?: BookingStore;
}

export interface ApproveResult {
  error?: string;
  /** The booking didn't go in (time taken, or Calendly's plan): nothing was
   *  sent and the draft is gone; J should offer times again. */
  rebook?: "slot_taken" | "plan";
}

type BookStep = { row: BookingRecord } | ApproveResult;

/** Approve on a booking draft: book first, send after (Kevin's Approve is
 *  the only thing that books). Idempotent per draft: a retry after a failed
 *  send finds the booking and doesn't book twice. */
async function bookForDraft(
  d: DraftView,
  payload: BookingPayload,
  contact: SetterContact,
  prev: SetterRecord | null,
  ctx: { store: SetterStore; bookings: BookingStore; calendar: CalendarSource; now: () => Date }
): Promise<BookStep> {
  const { store, bookings, calendar, now } = ctx;
  const existing = await bookings.byDraft(d.id);
  if (existing) return { row: existing };
  const base = {
    workspaceId: contact.workspaceId,
    draftId: d.id,
    contactId: contact.id,
    provider: payload.provider,
    eventTypeId: payload.eventTypeId,
    eventName: payload.eventName,
    timezone: payload.timezone,
    name: payload.name,
    email: payload.email,
  };
  if (payload.mode === "link") {
    const row = await bookings.create({ ...base, externalId: null, start: payload.start, end: payload.end, status: "LINK_SENT", url: payload.url });
    return { row };
  }
  const client = await calendar.provider(contact.workspaceId, payload.provider);
  if (!client) {
    const error = "The calendar isn't connected any more. Reconnect it in Integrations, or edit the draft to send your booking link.";
    await store.releaseDraft(d.id, error);
    return { error };
  }
  try {
    const out = await client.createBooking(
      payload.eventTypeId,
      { start: payload.start, end: payload.end },
      { name: payload.name, email: payload.email, timezone: payload.timezone }
    );
    const row = await bookings.create({
      ...base,
      externalId: out.kind === "booked" ? out.externalId : null,
      start: out.kind === "booked" ? out.start : payload.start,
      end: out.kind === "booked" ? out.end : payload.end,
      status: out.kind === "booked" ? "BOOKED" : "LINK_SENT",
      url: out.url,
    });
    return { row };
  } catch (err) {
    const code = err instanceof CalendarApiError ? err.code : null;
    const message = err instanceof Error ? err.message : "The booking didn't go through.";
    if (code !== "slot_taken" && code !== "plan") {
      await store.releaseDraft(d.id, message);
      return { error: `Not booked, nothing sent: ${message}` };
    }
    // Don't send "booked you in" for a booking that isn't there. Drop the
    // draft, remember why, and let J offer times again.
    await store.releaseDraft(d.id, message);
    await store.discardDraft(d.id);
    if (code === "plan") await calendar.noDirectBooking(contact.workspaceId, payload.provider).catch(() => {});
    const rec = prev ?? newRecord(contact.conversationId ?? contact.id, contact.username ?? "", contact.id);
    const at = iso(now())!;
    const bk = rec.booking ?? { phase: "proposed" as const, at };
    rec.booking = {
      ...bk,
      phase: "proposed",
      picked: null,
      timezone: payload.timezone,
      taken: code === "slot_taken" ? [...new Set([...(bk.taken ?? []), payload.start])].slice(-20) : bk.taken,
      at,
    };
    rec.draft = null;
    logEvent(rec, at, `booking:${code}`);
    await store.saveState(contact, rec);
    const when = formatSlot(payload.start, payload.timezone);
    return code === "slot_taken"
      ? { error: `${when} was just taken, so nothing was sent. J is offering new times.`, rebook: "slot_taken" }
      : {
          error: "Calendly only books from the API on paid plans (Standard and up). Nothing was sent. J now sends a link for that exact time instead.",
          rebook: "plan",
        };
  }
}

export async function approveDraft(draftId: string, workspaceId: string, opts: ApproveOptions = {}): Promise<ApproveResult> {
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

  const payload = d.kind === "booking" && d.booking ? d.booking : null;
  let booked: BookingRecord | null = null;
  const bookings = opts.bookings ?? bookingStore();
  if (payload) {
    const step = await bookForDraft(d, payload, contact, prev, { store, bookings, calendar: opts.calendar ?? calendarSource, now });
    if (!("row" in step)) return step;
    booked = step.row;
    await bookings.booked(contact, booked).catch((err) => console.error("[OS Setter] booking side effects:", err instanceof Error ? err.message : err));
  }

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
      await store.releaseDraft(d.id, booked ? `Booked, but the message didn't send: ${message}` : message);
      return { error: booked ? `The call is booked, but the message didn't send: ${message}. Approve again to resend (it won't book twice).` : message };
    }
    // Some bubbles are out: record what went, never resend those.
    await store.markSent(d.id, { bubbles: bubbles.slice(0, sentCount), editedText: edited ? opts.editedText! : null, edited });
    return { error: `Sent ${sentCount} of ${bubbles.length} bubbles, then: ${message}` };
  }
  await store.markSent(d.id, { bubbles, editedText: edited ? opts.editedText! : null, edited });

  let rec = prev ?? newRecord(contact.conversationId ?? contact.id, contact.username ?? "", contact.id);
  // The booking step this draft moved to (proposed, awaiting email…) only
  // counts once it was sent.
  const pending = rec.draft?.draft_id === d.id ? (rec.draft.booking ?? null) : null;
  rec = recordSend(rec, d.kind, bubbles, edited, humanAgent, now());
  const at = iso(now())!;
  if (booked && payload) {
    rec.booking = {
      ...(pending ?? rec.booking ?? { at }),
      phase: booked.status === "LINK_SENT" ? "link_sent" : "booked",
      booking_id: booked.id,
      start: booked.start,
      picked: booked.start,
      timezone: payload.timezone,
      at,
    };
    rec.invited ??= { route: "call", offer: null, at };
    logEvent(rec, at, `booking:${rec.booking.phase}`);
  } else if (pending) {
    rec.booking = { ...pending, timezone: pending.timezone ?? rec.booking?.timezone ?? null, at };
  }
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
