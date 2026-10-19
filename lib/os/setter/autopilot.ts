// Autopilot per funnel stage (Knowledge bases › Funnel). A stage set to
// "auto" lets J's draft at that stage go out without Approve, after a short
// random pause, through the same approveDraft path as a person's Approve:
// the send cap and Pause all apply, the A/B and voice-note logic run, and
// the booking step is never automatic. Default is "approve" everywhere, so
// nothing changes until Kevin flips a stage.
//
// Hook (lib/os/setter/queue.ts, processSetterJob, after draftForContact):
//   if (result.status === "drafted") await (await import("@/lib/os/setter/autopilot")).autopilotAfterDraft(contactId, result.draft);
//
// decideAutoSend / stageFor / cleanApprovals are pure; the runner takes its
// IO as deps so tests drive it without a database.

import { funnelColumns, funnelKeyFor } from "@/lib/os/funnel";
import type { FunnelStage } from "@/lib/os/setter/profile";
import type { DraftView, SetterContact } from "@/lib/os/setter/store";

export { CLEAN_TARGET } from "@/lib/os/setter/profile";
/** The flag an auto-sent draft carries (the Inbox shows "Sent by J"). */
export const AUTO_FLAG = "autopilot";
/** The OsEvent kind logged for every auto-send. */
export const AUTO_EVENT = "autopilot_sent";
/** Drafts that always wait for a person, whatever the stage says. */
export const NEEDS_A_PERSON = ["human_agent", "price", "unqualified", "sample", "calendar_off", "hand_to_kevin"] as const;
/** The pause before an auto-send: long enough to read as a person, short enough to matter. */
export const DELAY_MS = { min: 25_000, max: 75_000 } as const;

const colSlug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

/** The funnel stage J's stage hint (Draft.setterStage) lands in, as the board reads it. */
export function stageFor(setterStage: string | null | undefined, funnel: FunnelStage[]): FunnelStage | null {
  if (!setterStage || !funnel.length) return null;
  const key = funnelKeyFor(setterStage, funnelColumns(funnel));
  if (!key) return null;
  return funnel.find((s) => colSlug(s.key || s.label) === key) ?? null;
}

export interface AutoInput {
  draft: Pick<DraftView, "status" | "kind" | "flags" | "setterStage">;
  contact: Pick<SetterContact, "kind" | "paused">;
  funnel: FunnelStage[];
  /** The draft was put on hold (H in the composer). */
  held?: boolean;
}

export type AutoDecision = { send: true; stage: string } | { send: false; reason: string };

/** Pure: may this draft go out without Approve? */
export function decideAutoSend({ draft, contact, funnel, held }: AutoInput): AutoDecision {
  if (draft.status !== "PENDING") return { send: false, reason: "already handled" };
  if (held) return { send: false, reason: "on hold" };
  // Pitches and Personal: J never sends there on its own (nor Unsorted).
  if (contact.kind !== "SALES") return { send: false, reason: `contact is ${String(contact.kind).toLowerCase()}` };
  if (contact.paused) return { send: false, reason: "contact paused" };
  // Booking books a real call: only Kevin's Approve does that.
  if (draft.kind === "booking") return { send: false, reason: "booking needs Approve" };
  const flag = draft.flags.find((f) => (NEEDS_A_PERSON as readonly string[]).includes(f));
  if (flag) return { send: false, reason: `flagged ${flag}` };
  const stage = stageFor(draft.setterStage, funnel);
  if (!stage) return { send: false, reason: "no funnel stage" };
  if (stage.autopilot !== "auto") return { send: false, reason: `${stage.label} is on Approve` };
  return { send: true, stage: stage.key };
}

export function autoDelayMs(random: () => number = Math.random): number {
  return Math.round(DELAY_MS.min + random() * (DELAY_MS.max - DELAY_MS.min));
}

export interface SentDraftRow {
  setterStage: string | null;
  edited: boolean;
  flags: string[];
}

/** Pure: clean approvals per stage key: J's draft approved and sent without
 *  edits by a person (auto-sends don't count). */
export function cleanApprovals(rows: SentDraftRow[], funnel: FunnelStage[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(funnel.map((s) => [s.key, 0]));
  for (const r of rows) {
    if (r.edited || r.flags.includes(AUTO_FLAG)) continue;
    const s = stageFor(r.setterStage, funnel);
    if (s) out[s.key] = (out[s.key] ?? 0) + 1;
  }
  return out;
}

/** Pure: auto-sends per stage key ("Sent by J"). */
export function autoSends(rows: SentDraftRow[], funnel: FunnelStage[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(funnel.map((s) => [s.key, 0]));
  for (const r of rows) {
    if (!r.flags.includes(AUTO_FLAG)) continue;
    const s = stageFor(r.setterStage, funnel);
    if (s) out[s.key] = (out[s.key] ?? 0) + 1;
  }
  return out;
}

// ---------------------------------------------------------------- runner
export interface AutopilotDeps {
  getContact(contactId: string): Promise<(SetterContact & { workspaceId: string }) | null>;
  /** The draft as it is now, plus whether it is on hold. */
  getDraft(draftId: string, workspaceId: string): Promise<{ draft: DraftView; held: boolean } | null>;
  /** The setter's funnel (Setter.funnel through asFunnel). */
  funnelOf(setterId: string, workspaceId: string): Promise<FunnelStage[]>;
  /** approveDraft with no edits: cap, Pause all, voice, A/B, state. */
  approve(draftId: string, workspaceId: string): Promise<{ error?: string }>;
  /** Mark the draft and log the auto-send. */
  logSent(e: { workspaceId: string; contactId: string; setterId: string | null; draftId: string; stage: string; at: Date }): Promise<void>;
  sleep(ms: number): Promise<void>;
  random?: () => number;
  now?: () => Date;
}

export type AutopilotResult = { status: "sent"; stage: string } | { status: "skipped"; reason: string } | { status: "failed"; reason: string };

async function check(contactId: string, draftId: string, deps: AutopilotDeps): Promise<{ decision: AutoDecision; contact: SetterContact | null; draft: DraftView | null }> {
  const contact = await deps.getContact(contactId);
  if (!contact) return { decision: { send: false, reason: "contact not found" }, contact: null, draft: null };
  const cur = await deps.getDraft(draftId, contact.workspaceId);
  if (!cur) return { decision: { send: false, reason: "draft gone" }, contact, draft: null };
  if (!cur.draft.setterId) return { decision: { send: false, reason: "no knowledge base" }, contact, draft: cur.draft };
  const funnel = await deps.funnelOf(cur.draft.setterId, contact.workspaceId);
  return { decision: decideAutoSend({ draft: cur.draft, contact, funnel, held: cur.held }), contact, draft: cur.draft };
}

/** After J drafts: if its stage is on Auto, wait a short random pause, check
 *  everything again (Kevin may have approved, edited, held or flipped the
 *  switch meanwhile) and send through approveDraft. Never throws. */
export async function autopilotAfterDraft(contactId: string, drafted: Pick<DraftView, "id">, deps: AutopilotDeps = defaultDeps()): Promise<AutopilotResult> {
  try {
    const first = await check(contactId, drafted.id, deps);
    if (!first.decision.send) return { status: "skipped", reason: first.decision.reason };
    await deps.sleep(autoDelayMs(deps.random));
    const { decision, contact, draft } = await check(contactId, drafted.id, deps);
    if (!decision.send || !contact || !draft) return { status: "skipped", reason: decision.send ? "gone" : decision.reason };
    const r = await deps.approve(draft.id, contact.workspaceId);
    if (r.error) {
      // Cap reached or Pause all: the draft stays in the Inbox for Approve.
      console.log(`[OS Autopilot] ${draft.id} not sent: ${r.error}`);
      return { status: "failed", reason: r.error };
    }
    const at = (deps.now ?? (() => new Date()))();
    await deps.logSent({ workspaceId: contact.workspaceId, contactId: contact.id, setterId: draft.setterId ?? null, draftId: draft.id, stage: decision.stage, at }).catch((err) =>
      console.error("[OS Autopilot] log failed:", err instanceof Error ? err.message : err)
    );
    console.log(`[OS Autopilot] ${draft.id} sent by J at ${decision.stage}`);
    return { status: "sent", stage: decision.stage };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("[OS Autopilot] failed:", reason);
    return { status: "failed", reason };
  }
}

function defaultDeps(): AutopilotDeps {
  return {
    async getContact(contactId) {
      const { setterStore } = await import("@/lib/os/setter/store");
      return setterStore().getContact(contactId);
    },
    async getDraft(draftId, workspaceId) {
      const { setterStore } = await import("@/lib/os/setter/store");
      const draft = await setterStore().getDraft(draftId, workspaceId);
      if (!draft) return null;
      const { prisma } = await import("@/lib/db/client");
      const row = await prisma.draft.findUnique({ where: { id: draftId }, select: { heldAt: true } }).catch(() => null);
      return { draft, held: Boolean(row?.heldAt) };
    },
    async funnelOf(setterId, workspaceId) {
      const { prisma } = await import("@/lib/db/client");
      const { asFunnel } = await import("@/lib/os/setter/kb");
      const s = await prisma.setter.findFirst({ where: { id: setterId, workspaceId }, select: { funnel: true } });
      return s ? asFunnel(s.funnel) : [];
    },
    async approve(draftId, workspaceId) {
      const { approveDraft } = await import("@/lib/os/setter/service");
      return approveDraft(draftId, workspaceId);
    },
    async logSent(e) {
      const { prisma } = await import("@/lib/db/client");
      await prisma.draft.update({ where: { id: e.draftId }, data: { flags: { push: AUTO_FLAG } } });
      await prisma.osEvent.createMany({
        data: [
          {
            workspaceId: e.workspaceId,
            contactId: e.contactId,
            setterId: e.setterId,
            kind: AUTO_EVENT,
            dedupeKey: `${AUTO_EVENT}:${e.draftId}`,
            at: e.at,
            data: { draftId: e.draftId, stage: e.stage },
          },
        ],
        skipDuplicates: true,
      });
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}
