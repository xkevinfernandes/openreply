// The follow-up engine: keeps exactly the ONE step plan.ts says is next
// queued for a contact, and acts on Kevin's buttons (skip, cancel, send now,
// Follow-ups off, showed / no-show).
//
//   syncFollowups(contactId)  ← after every J evaluation, approve, discard,
//                               booking event, attendance mark, settings change
//   deliverStep(stepId)       ← the delayed job at the step's time (deliver.ts)
//
// Approve-only: nothing here sends. deliverStep writes a J draft; a person
// approves it (approveDraft). "Send now" is that person pressing send.

import { prisma } from "@/lib/db/client";
import { osEventHooks } from "@/lib/os/events-hooks";
import { fireContactEvent } from "@/lib/os/integrations/queue";
import { osMockEnabled, updateMockContact } from "@/lib/os/mock";
import { getSetterConfig } from "@/lib/os/setter/config";
import { approveDraft } from "@/lib/os/setter/service";
import { iso, recordSkip } from "@/lib/os/setter/state";
import { setterStore, type SetterContact, type SetterStore } from "@/lib/os/setter/store";
import { planFollowup, STOPPED, type PlanResult } from "@/lib/os/sequences/plan";
import { sequenceStore, type AttendanceName, type SequenceStore, type StepRow, type TaskContext, type TaskRow } from "@/lib/os/sequences/store";
import type { Sequence } from "@/lib/os/sequences/types";

export const FOLLOWUP_DRAFT_KIND = "followup";

/** The Draft.anchor of a follow-up draft. */
export function followupAnchor(key: string): string {
  return `followup:${key}`;
}

const LIVE = ["QUEUED", "DRAFTED"];

export interface EngineDeps {
  steps?: SequenceStore;
  setter?: SetterStore;
  /** Puts the step on the worker at its time (default: a delayed os-setter job). */
  schedule?: (step: StepRow) => Promise<void>;
  now?: Date;
  workspaceId?: string;
  /** In a live workflow run (O1). Default: Postgres, or false with a test store. */
  inWorkflow?: (contactId: string) => Promise<boolean>;
}

async function defaultSchedule(step: StepRow) {
  // Lazy: the queue module imports this one for the worker.
  const { enqueueFollowupStep } = await import("@/lib/os/setter/queue");
  await enqueueFollowupStep(step.id, step.dueAt);
}

export interface SyncResult {
  live: StepRow | null;
  /** Why nothing is queued (null when something is). */
  why: string | null;
}

/** Plan inputs for one contact (also what the thread strip shows). */
export async function planFor(contact: SetterContact, deps: EngineDeps = {}): Promise<{ result: PlanResult; history: StepRow[]; setterId: string | null }> {
  const steps = deps.steps ?? sequenceStore();
  const setter = deps.setter ?? setterStore();
  const inWorkflow = deps.inWorkflow ?? (deps.steps ? async () => false : async (id: string) => (await import("@/lib/os/workflows/hooks")).inLiveWorkflow(id));
  const [history, rec, followupsOff, booking, loaded, wf] = await Promise.all([
    steps.history(contact.id),
    setter.loadState(contact.id),
    steps.followupsOff(contact.id),
    steps.latestBooking(contact.workspaceId, contact.id),
    steps.loadSet(contact.workspaceId, contact.setterId ?? null, contact.instagramAccountId),
    inWorkflow(contact.id),
  ]);
  const result = planFollowup({
    now: deps.now ?? new Date(),
    contact: { kind: contact.kind, paused: contact.paused, followupsOff, tags: contact.tags, setterStage: contact.setterStage, inWorkflow: wf },
    rec,
    booking,
    sequences: loaded.set,
    history,
    cfg: getSetterConfig(),
  });
  return { result, history, setterId: loaded.setterId };
}

/** A drafted step whose draft was sent or dropped: record what happened. */
async function settleDrafted(live: StepRow, contact: SetterContact, steps: SequenceStore, setter: SetterStore): Promise<boolean> {
  if (live.status !== "DRAFTED" || !live.draftId) return false;
  const d = await setter.getDraft(live.draftId, contact.workspaceId);
  if (d && (d.status === "PENDING" || d.status === "APPROVED")) return false;
  if (d?.status === "SENT") {
    await steps.update(live.id, { status: "SENT" });
    return true;
  }
  // Discarded: by Kevin (Skip, the anchor is remembered) or replaced by a newer draft.
  const rec = await setter.loadState(contact.id);
  const skipped = (rec?.skipped_anchors ?? []).includes(followupAnchor(live.key));
  await steps.update(live.id, skipped ? { status: "SKIPPED", reason: "Skipped" } : { status: "CANCELLED", reason: "Replaced by another draft" });
  return true;
}

/** Make the queue match the plan for one contact. Idempotent and safe to call
 *  any time; never queues a second step for the same person. */
export async function syncFollowups(contactId: string, deps: EngineDeps = {}): Promise<SyncResult> {
  const steps = deps.steps ?? sequenceStore();
  const setter = deps.setter ?? setterStore();
  const schedule = deps.schedule ?? defaultSchedule;
  const contact = await setter.getContact(contactId, deps.workspaceId);
  if (!contact) return { live: null, why: "Contact not found." };

  let current = (await steps.history(contactId)).find((h) => LIVE.includes(h.status)) ?? null;
  if (current && (await settleDrafted(current, contact, steps, setter))) current = null;

  const { result, setterId } = await planFor(contact, { ...deps, steps, setter });
  const plan = result.plan;

  if (current && plan && current.key === plan.key) {
    if (current.status === "QUEUED" && (current.dueAt !== plan.dueAt || JSON.stringify(current.step) !== JSON.stringify(plan.step))) {
      // The step was edited in settings (or the window squeezed it): same step, new time.
      await steps.update(current.id, { dueAt: plan.dueAt, step: plan.step });
      const moved = { ...current, dueAt: plan.dueAt, step: plan.step };
      await schedule(moved);
      return { live: moved, why: null };
    }
    return { live: current, why: null };
  }

  if (current) {
    // The plan moved on: they replied, the call moved, the sequence was switched off…
    if (current.status === "DRAFTED" && current.draftId) await setter.discardDraft(current.draftId).catch(() => false);
    await steps.update(current.id, { status: "CANCELLED", reason: plan ? "Replaced by the next step" : (result.why || "No longer due") });
  }
  if (!plan) return { live: null, why: result.why };

  const row = await steps.queue(
    {
      workspaceId: contact.workspaceId,
      contactId,
      setterId,
      sequence: plan.sequence,
      stepId: plan.step.id,
      stepIndex: plan.stepIndex,
      episode: plan.episode,
      key: plan.key,
      dueAt: plan.dueAt,
      step: plan.step,
      bookingId: plan.bookingId,
    },
    "Replaced by the next step"
  );
  if (row?.status === "QUEUED") await schedule(row);
  return { live: row, why: row ? null : result.why };
}

/** Never throws: for hooks after J's evaluations, approvals and webhooks. */
export async function syncFollowupsQuietly(contactId: string, deps: EngineDeps = {}): Promise<void> {
  try {
    await syncFollowups(contactId, deps);
  } catch (err) {
    console.error("[OS Follow-ups] sync failed:", err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------- Kevin's buttons
export type EngineResult = { error?: string; notice?: string };

async function liveStep(workspaceId: string, stepId: string, steps: SequenceStore): Promise<StepRow | null> {
  const s = await steps.getStep(stepId, workspaceId);
  return s && LIVE.includes(s.status) ? s : null;
}

/** Skip this one step; the next one in the sequence is queued. */
export async function skipStep(workspaceId: string, stepId: string, deps: EngineDeps = {}): Promise<EngineResult> {
  const steps = deps.steps ?? sequenceStore();
  const setter = deps.setter ?? setterStore();
  const s = await liveStep(workspaceId, stepId, steps);
  if (!s) return { error: "That follow-up already went (or was cancelled). Refresh the page." };
  if (s.status === "DRAFTED" && s.draftId) {
    await setter.discardDraft(s.draftId).catch(() => false);
    const contact = await setter.getContact(s.contactId, workspaceId);
    const rec = contact ? await setter.loadState(contact.id) : null;
    if (contact && rec) await setter.saveState(contact, recordSkip(rec, followupAnchor(s.key), `skipped:followup:${s.stepId}`, iso(new Date())));
  }
  await steps.update(s.id, { status: "SKIPPED", reason: "Skipped by you" });
  await syncFollowups(s.contactId, { ...deps, steps, setter, workspaceId });
  return {};
}

/** Stop the rest of this sequence for this person. A new silence (after
 *  their next reply) or a new booking starts fresh. */
export async function cancelSequence(workspaceId: string, contactId: string, deps: EngineDeps = {}): Promise<EngineResult> {
  const steps = deps.steps ?? sequenceStore();
  const setter = deps.setter ?? setterStore();
  if (!(await setter.getContact(contactId, workspaceId))) return { error: "Contact not found." };
  const live = (await steps.history(contactId)).find((h) => LIVE.includes(h.status));
  if (!live) return { error: "Nothing queued for them any more. Refresh the page." };
  if (live.status === "DRAFTED" && live.draftId) await setter.discardDraft(live.draftId).catch(() => false);
  await steps.update(live.id, { status: "CANCELLED", reason: STOPPED });
  await syncFollowups(contactId, { ...deps, steps, setter, workspaceId });
  return {};
}

/** Per-thread Follow-ups off / on. */
export async function setThreadFollowups(workspaceId: string, contactId: string, on: boolean, deps: EngineDeps = {}): Promise<EngineResult> {
  const steps = deps.steps ?? sequenceStore();
  await steps.setFollowupsOff(workspaceId, contactId, !on);
  await syncFollowups(contactId, { ...deps, steps, workspaceId });
  return {};
}

/** Send now. A drafted step: approve it. A queued one: J writes it now; a
 *  fixed line (the text is on screen) goes straight out, J's own words wait
 *  for your approve. */
export async function sendStepNow(workspaceId: string, stepId: string, deps: EngineDeps = {}): Promise<EngineResult> {
  const steps = deps.steps ?? sequenceStore();
  const setter = deps.setter ?? setterStore();
  let s = await liveStep(workspaceId, stepId, steps);
  if (!s) return { error: "That follow-up already went (or was cancelled). Refresh the page." };
  if (s.status === "QUEUED") {
    const { deliverStep } = await import("@/lib/os/sequences/deliver");
    const r = await deliverStep(s.id, { force: true, workspaceId, steps, setter, schedule: deps.schedule });
    if (r.status !== "drafted") return { notice: r.reason };
    s = r.step;
    if (!r.fixed) return { notice: "J wrote it. Read it, then Approve & send." };
  }
  if (!s.draftId) return { error: "No draft for that follow-up yet." };
  const sent = await approveDraft(s.draftId, workspaceId, { store: setter });
  await syncFollowupsQuietly(s.contactId, { ...deps, steps, setter, workspaceId });
  return sent.error ? { error: sent.error } : {};
}

// ---------------------------------------------------------------- after the call
/** Showed / No-show / not marked (null), from Kevin or the calendar. */
export async function markAttendance(
  workspaceId: string,
  contactId: string,
  attendance: AttendanceName | null,
  source: "user" | "calcom" | "calendly" = "user",
  deps: EngineDeps & { bookingId?: string } = {}
): Promise<EngineResult> {
  const steps = deps.steps ?? sequenceStore();
  const setter = deps.setter ?? setterStore();
  const contact = await setter.getContact(contactId, workspaceId);
  if (!contact) return { error: "Contact not found." };
  const booking = await steps.latestBooking(workspaceId, contactId);
  if (!booking || (deps.bookingId && booking.id !== deps.bookingId)) return { error: "No call on record for them." };
  const now = deps.now ?? new Date();
  if (attendance && new Date(booking.start).getTime() > now.getTime()) return { error: "The call hasn't started yet." };
  await steps.setAttendance(workspaceId, booking.id, attendance, source, now);
  // OsEvent "showed" (Home); only on the real store, tests pass their own.
  if (!deps.steps) await osEventHooks.onAttendance({ workspaceId, contactId, bookingId: booking.id, attendance, at: now });

  if (attendance === "SHOWED") {
    const { set } = await steps.loadSet(workspaceId, contact.setterId ?? null, contact.instagramAccountId);
    if (set.showed.enabled) await createVoiceNoteTask(contact, booking.id, booking.start, { steps, setter });
    await setStage(contact, "SHOWED").catch((err) => console.error("[OS Follow-ups] stage:", err instanceof Error ? err.message : err));
  }
  await syncFollowups(contactId, { ...deps, steps, setter, workspaceId });
  return {};
}

async function setStage(contact: SetterContact, stage: "SHOWED") {
  if (osMockEnabled()) {
    updateMockContact(contact.id, { stage });
    return;
  }
  // Through the one stage writer: showing up is the booking's outcome (cause booking).
  const { writeStage } = await import("@/lib/os/stage-writer");
  const r = await writeStage({ workspaceId: contact.workspaceId, contactId: contact.id, cause: "booking", change: { type: "stage", stage } });
  if (r.status === "applied") await fireContactEvent({ workspaceId: contact.workspaceId, contactId: contact.id, event: "stage_changed" });
}

function clip(s: string | null | undefined, n = 240): string | null {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t ? (t.length > n ? `${t.slice(0, n - 1)}…` : t) : null;
}

/** Their goal and pain from J's drafts (the invite quotes them in their words),
 *  your notes, and their last few messages. */
export async function voiceNoteContext(contact: SetterContact, callAt: string | null, setter: SetterStore): Promise<TaskContext> {
  let goal: string | null = null;
  let pain: string | null = null;
  let notes: string | null = null;
  if (!osMockEnabled()) {
    try {
      const [drafts, row] = await Promise.all([
        prisma.draft.findMany({ where: { contactId: contact.id }, orderBy: { createdAt: "desc" }, take: 40, select: { raw: true } }),
        prisma.contact.findUnique({ where: { id: contact.id }, select: { notes: true } }),
      ]);
      notes = clip(row?.notes, 400);
      for (const d of drafts) {
        const raw = (d.raw && typeof d.raw === "object" ? d.raw : {}) as { invite?: Record<string, unknown> | null; qualification?: Record<string, unknown> | null };
        goal ??= clip(typeof raw.invite?.their_goal === "string" ? raw.invite.their_goal : null);
        pain ??= clip(typeof raw.invite?.their_challenge === "string" ? raw.invite.their_challenge : typeof raw.qualification?.pain === "string" ? raw.qualification.pain : null);
        if (goal && pain) break;
      }
    } catch (err) {
      console.error("[OS Follow-ups] task context:", err instanceof Error ? err.message : err);
    }
  } else {
    const { mockContactExtras } = await import("@/lib/os/mock");
    notes = clip(mockContactExtras(contact.id).notes, 400);
  }
  const thread = await setter.readThread(contact).catch(() => []);
  const lastWords = thread
    .filter((m) => m.incoming && (m.text ?? "").trim() && !m.attachment)
    .slice(-3)
    .map((m) => clip(m.text, 200)!)
    .filter(Boolean);
  return { goal, pain, notes, lastWords, callAt };
}

export async function createVoiceNoteTask(
  contact: SetterContact,
  bookingId: string,
  callAt: string | null,
  deps: { steps?: SequenceStore; setter?: SetterStore } = {}
): Promise<TaskRow> {
  const steps = deps.steps ?? sequenceStore();
  const setter = deps.setter ?? setterStore();
  const context = await voiceNoteContext(contact, callAt, setter).catch(() => ({ goal: null, pain: null, notes: null, lastWords: [], callAt }));
  return steps.createTask({
    workspaceId: contact.workspaceId,
    contactId: contact.id,
    kind: "voice_note",
    title: `Send a personal voice note to ${contact.username ? `@${contact.username}` : "them"}`,
    context,
    dedupeKey: `voice_note:${bookingId}`,
    bookingId,
  });
}

export async function setTaskDone(workspaceId: string, taskId: string, done: boolean, deps: EngineDeps = {}): Promise<EngineResult> {
  const ok = await (deps.steps ?? sequenceStore()).setTaskStatus(workspaceId, taskId, done ? "DONE" : "OPEN");
  return ok ? {} : { error: "That task is gone. Refresh the page." };
}

// ---------------------------------------------------------------- settings
/** Save one sequence of a setter. Switching it off cancels its live steps;
 *  switching it on (or editing) re-plans the people it applies to. */
export async function saveSetterSequence(workspaceId: string, setterId: string, seq: Sequence, deps: EngineDeps = {}): Promise<EngineResult> {
  const steps = deps.steps ?? sequenceStore();
  await steps.saveSequence(workspaceId, setterId, seq);
  const live = await steps.listLive(workspaceId, { sequence: seq.key });
  const ids = new Set(live.filter((s) => s.setterId === setterId || s.setterId === null).map((s) => s.contactId));
  if (seq.enabled && !osMockEnabled()) {
    // People this setter answers who were active this week may now need a step.
    const recent = await prisma.setterState.findMany({
      where: { workspaceId, updatedAt: { gte: new Date(Date.now() - 7 * 86_400_000) }, contact: { kind: "SALES", OR: [{ setterId }, { setterId: null }] } },
      select: { contactId: true },
      take: 200,
    });
    for (const r of recent) ids.add(r.contactId);
  }
  if (osMockEnabled()) {
    const { mockThreads } = await import("@/lib/os/mock");
    for (const t of mockThreads()) if (t.contact?.kind === "SALES") ids.add(t.contact.id);
  }
  for (const id of ids) await syncFollowupsQuietly(id, { ...deps, steps, workspaceId });
  return {};
}
