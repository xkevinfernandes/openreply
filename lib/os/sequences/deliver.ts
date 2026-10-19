// deliverStep: turn a due follow-up step into a J draft. The single entry
// point for the worker's delayed job, "Send now", and (later) the autopilot,
// which can call deliverStep and then approveDraft on what it returns.
//
// Approve-only for now: this writes a Draft (kind "followup"); nothing sends.
// Every check runs again here, at send time, against the live thread:
//   - the plan still wants THIS step (they may have replied a minute ago),
//   - Meta's window: free 24h, else HUMAN_AGENT (flagged, approve-only), else skip,
//   - a reply draft waiting for Kevin is never replaced (the step waits),
//   - J may hold: holding is valid, the step is skipped and the next one queued.

import { linesBlock, linesForDraft, tagsFor, type OfferedLine } from "@/lib/os/experiments";
import type { ExperimentStore } from "@/lib/os/experiments/store";
import { getSetterConfig } from "@/lib/os/setter/config";
import { draft as runDrafter, DraftError } from "@/lib/os/setter/drafter";
import type { KnowledgeSource } from "@/lib/os/setter/kb";
import { loadMethod } from "@/lib/os/setter/knowledge";
import { bubblesOf, buildPrompt, mentionsPrice, systemPrompt, type DraftObject } from "@/lib/os/setter/prompt";
import { dmPayload, linkOf } from "@/lib/os/setter/resources";
import { dbKnowledge } from "@/lib/os/setter/setters";
import { logEvent, newRecord, observe, slugsWithTagPrefix, windowState, type SetterRecord } from "@/lib/os/setter/state";
import { setterStore, type DraftView, type SetterStore } from "@/lib/os/setter/store";
import type { CatalogRow } from "@/lib/os/setter/types";
import { FOLLOWUP_DRAFT_KIND, followupAnchor, planFor, syncFollowups } from "@/lib/os/sequences/engine";
import { sequenceStore, type SequenceStore, type StepRow } from "@/lib/os/sequences/store";
import { SEQUENCE_META, isSequenceKey, type SequenceStep } from "@/lib/os/sequences/types";

/** How long a step waits when a reply draft is in the way. */
export const DEFER_MINUTES = 30;

export type DeliverResult =
  | { status: "drafted"; step: StepRow; draft: DraftView; fixed: boolean }
  | { status: "not_due" | "deferred" | "skipped" | "cancelled" | "gone"; reason: string };

export interface DeliverOptions {
  /** A person pressed Send now: don't wait for the time. */
  force?: boolean;
  workspaceId?: string;
  steps?: SequenceStore;
  setter?: SetterStore;
  knowledge?: KnowledgeSource;
  schedule?: (step: StepRow) => Promise<void>;
  now?: Date;
  /** A/B lines (default: DB / OS_MOCK). */
  experiments?: ExperimentStore;
}

/** The active resources this setter offers that they haven't had, best first. */
export function nurturePick(offered: CatalogRow[], rec: SetterRecord, tags: string[]): CatalogRow | null {
  const had = new Set([...(rec.resources_sent ?? []), ...slugsWithTagPrefix(tags, "sent:"), ...slugsWithTagPrefix(rec.tags ?? [], "sent:")]);
  return offered.find((r) => r.type !== "setter" && (r.status ?? "active") === "active" && linkOf(r) && !had.has(r.slug)) ?? null;
}

/** What J is told for this step (the FOLLOW-UP section of the prompt). */
export function followupBlock(step: SequenceStep, row: Pick<StepRow, "sequence" | "stepIndex">, stepCount: number, resource: CatalogRow | null): string {
  const title = isSequenceKey(row.sequence) ? SEQUENCE_META[row.sequence].title : row.sequence;
  const lines = [
    `FOLLOW-UP STEP: "${step.label}" (sequence "${title}", step ${row.stepIndex + 1} of ${stepCount}).`,
    `What to do: ${step.intent || "a light, human follow-up"}`,
    "Rules: never pushy, no guilt, no \"just checking in\", no repeat of an earlier question. Match their energy. 1-2 short bubbles. " +
      "If nothing natural fits, hold (hold=true, bubbles []): saying nothing is valid.",
  ];
  if (step.voicePhrase.trim()) lines.push(`Use this exact line as its own bubble (Kevin has it recorded as a voice note): "${step.voicePhrase.trim()}"`);
  if (resource) {
    lines.push(
      `Share this resource (they haven't had it). Put this exact link on its own line: ${linkOf(resource)}\n` +
        `About it: ${resource.for_setter || resource.blurb || resource.name || resource.slug}`
    );
  }
  return lines.join("\n");
}

function resourceBubble(row: CatalogRow): string {
  const p = dmPayload(row.slug, [row]);
  return p.buttons?.length ? `${p.message}\n\n${linkOf(row)}` : p.message;
}

export async function deliverStep(stepId: string, opts: DeliverOptions = {}): Promise<DeliverResult> {
  const steps = opts.steps ?? sequenceStore();
  const setter = opts.setter ?? setterStore();
  const now = opts.now ?? new Date();
  const cfg = getSetterConfig();
  const deps = { steps, setter, schedule: opts.schedule, now, workspaceId: opts.workspaceId };

  const step = await steps.getStep(stepId, opts.workspaceId);
  if (!step) return { status: "gone", reason: "That follow-up is gone." };
  if (step.status !== "QUEUED") {
    if (step.status === "DRAFTED" && step.draftId) {
      const d = await setter.getDraft(step.draftId, step.workspaceId);
      if (d?.status === "PENDING") return { status: "drafted", step, draft: d, fixed: Boolean(step.step.fixedLine) };
    }
    return { status: "gone", reason: "That follow-up already went (or was cancelled)." };
  }
  if (!opts.force && new Date(step.dueAt).getTime() > now.getTime() + 60_000) return { status: "not_due", reason: `Due ${step.dueAt}.` };

  const contact = await setter.getContact(step.contactId, step.workspaceId);
  if (!contact) return { status: "gone", reason: "Contact not found." };
  const setterKb = await (opts.knowledge ?? dbKnowledge).forContact(contact);

  // Fold the live thread in: a reply that came in since the last look stops this step.
  const msgs = await setter.readThread(contact);
  let rec = (await setter.loadState(contact.id)) ?? newRecord(contact.conversationId ?? contact.id, contact.username ?? "", contact.id);
  rec = observe(rec, msgs, contact.tags, setterKb.catalog.resources, now, cfg);
  await setter.saveState(contact, rec);

  const { result } = await planFor(contact, deps);
  if (result.plan?.key !== step.key) {
    await syncFollowups(contact.id, deps);
    return { status: "cancelled", reason: result.why || "The plan moved on, so this one won't go." };
  }

  const skip = async (reason: string): Promise<DeliverResult> => {
    await steps.update(step.id, { status: "SKIPPED", reason });
    await syncFollowups(contact.id, deps);
    return { status: "skipped", reason };
  };

  const [win] = windowState(rec.their_last_at, now, cfg);
  if (win === "closed") return skip("Instagram's window closed (7 days since their last message).");
  const humanAgent = win === "human_agent";

  const pending = await setter.pendingDraft(contact.id);
  if (pending && pending.kind !== FOLLOWUP_DRAFT_KIND) {
    // Kevin hasn't handled a reply yet: never overwrite it. Try again shortly.
    const later = new Date(now.getTime() + DEFER_MINUTES * 60_000).toISOString();
    await steps.update(step.id, { dueAt: later });
    const schedule =
      opts.schedule ??
      (async (s: StepRow) => {
        const { enqueueFollowupStep } = await import("@/lib/os/setter/queue");
        await enqueueFollowupStep(s.id, s.dueAt);
      });
    await schedule({ ...step, dueAt: later });
    return { status: "deferred", reason: "A draft is already waiting for you in this thread. This follow-up waits until it's handled." };
  }

  const cfgStep = step.step;
  const resource = cfgStep.resource ? nurturePick(setterKb.offered.resources, rec, contact.tags) : null;
  if (cfgStep.resource && !resource) return skip("No resource left that they haven't had.");

  // A/B: the first no-reply step is the "follow-up 1" line Kevin may be testing.
  let abLines: OfferedLine[] = [];
  if (step.sequence.startsWith("no_reply_") && step.stepIndex === 0) {
    const lines = await linesForDraft({
      workspaceId: contact.workspaceId,
      setterId: setterKb.setterId,
      person: { workspaceId: contact.workspaceId, instagramAccountId: contact.instagramAccountId ?? "mock", igUserId: contact.igUserId, contactId: contact.id },
      name: contact.fullName ?? contact.username,
      entry: rec.entry?.via ?? null,
      actionKind: "nudge",
      firstMessage: false,
      nudgesSoFar: 0,
      alreadyInvited: true,
      store: opts.experiments,
    });
    abLines = lines.filter((l) => l.key === "follow_up_1");
  }

  let bubbles: string[];
  let reasoning: string;
  let raw: unknown;
  let usage = { backend: "fixed", model: "fixed", inputTokens: 0, outputTokens: 0 } as { backend: string; model: string; inputTokens?: number; outputTokens?: number };
  const fixedText = cfgStep.fixedLine.trim();
  const fixed = Boolean(fixedText);
  const stepCount = result.plan.stepCount;
  if (fixed) {
    // A fixed line gives way to the A/B line being tested in its place.
    bubbles = [abLines[0]?.text ?? fixedText, ...(resource ? [resourceBubble(resource)] : [])];
    reasoning = `${cfgStep.label}: your fixed line.`;
    raw = null;
  } else {
    const action = { kind: "followup" as const, anchor: followupAnchor(step.key), human_agent: humanAgent };
    const system = systemPrompt(loadMethod(), setterKb.profile, setterKb.offered, now.toISOString().slice(0, 10));
    const prompt = buildPrompt(rec, msgs, action, setterKb.catalog, now, [followupBlock(cfgStep, step, stepCount, resource), linesBlock(abLines)]);
    let out;
    try {
      out = await runDrafter({ system, prompt, job: "draft", settings: cfg.drafter });
    } catch (err) {
      throw err instanceof DraftError ? err : new DraftError(err instanceof Error ? err.message : String(err));
    }
    const obj = (out.obj && typeof out.obj === "object" ? out.obj : {}) as DraftObject;
    bubbles = bubblesOf(obj);
    if (obj.hold || !bubbles.length) return skip(`J held: ${obj.hold_reason || "nothing natural to say"}`);
    // The resource link must be there; J sometimes forgets it.
    if (resource && !bubbles.some((b) => b.includes(linkOf(resource)))) bubbles.push(linkOf(resource));
    reasoning = obj.stage_reasoning || obj.reasoning || `${cfgStep.label}.`;
    raw = obj;
    usage = out.usage;
  }

  // A voice clip phrase rides in the text: the voice bank's substitution at
  // send time (approveDraft) plays the clip for the bubble carrying it.
  const phrase = cfgStep.voicePhrase.trim();
  if (phrase && !bubbles.some((b) => b.toLowerCase().includes(phrase.toLowerCase()))) bubbles.unshift(phrase);
  const abVariants = abLines.length ? tagsFor(abLines, (raw as DraftObject | null)?.ab_lines_used, bubbles) : null;
  const flags = ["followup"];
  if (humanAgent) flags.push("human_agent");
  if (mentionsPrice(bubbles)) flags.push("price");
  if (usage.backend === "fake") flags.push("sample");
  const d = await setter.createDraft({
    workspaceId: contact.workspaceId,
    contactId: contact.id,
    kind: FOLLOWUP_DRAFT_KIND,
    anchor: followupAnchor(step.key),
    bubbles,
    reasoning,
    setterStage: null,
    humanAgent,
    flags,
    proposedTags: {},
    // The voice bank reads followup.voicePhrase: a matching clip goes instead of the text.
    raw: { ...(raw && typeof raw === "object" ? raw : {}), followup: { stepKey: step.key, sequence: step.sequence, stepId: step.stepId, voicePhrase: cfgStep.voicePhrase || null, resource: resource?.slug ?? null } },
    backend: usage.backend,
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    setterId: setterKb.setterId,
    abVariants,
  });
  await steps.update(step.id, { status: "DRAFTED", draftId: d.id });
  rec.draft = { anchor: followupAnchor(step.key), kind: FOLLOWUP_DRAFT_KIND, draft_id: d.id };
  logEvent(rec, now, `drafted:followup:${step.sequence}:${step.stepId}`);
  await setter.saveState(contact, rec);
  return { status: "drafted", step: { ...step, status: "DRAFTED", draftId: d.id }, draft: d, fixed };
}
