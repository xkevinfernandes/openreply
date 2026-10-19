// Loading experiments: each variant's funnel, counted from existing data
// (funnel.ts), plus the verdict (stats.ts). Line tests show in Knowledge
// bases › setter › Tests; campaign opener tests on the campaign row.

import { prisma } from "@/lib/db/client";
import { osMockEnabled } from "@/lib/os/mock";
import { byVariant, emptyCounts, factsFromRecord, type ContactFacts, type Exposure, type FunnelCounts } from "@/lib/os/experiments/funnel";
import { lineVerdict, pct, verdict, wilson, type LineVerdict, type Verdict } from "@/lib/os/experiments/stats";
import { experimentStore, mockSampleCounts, type AssignmentRow, type ExperimentFull } from "@/lib/os/experiments/store";
import { baseSlot, ENTRY_PATHS, LINE_KEYS, parseSlot, STAGE_LINES, stageLineOf, type ExperimentStatusName, type StageLineKey } from "@/lib/os/experiments/types";
import type { SetterRecord } from "@/lib/os/setter/state";

export interface VariantRow {
  id: string;
  label: string;
  text: string;
  weight: number;
  active: boolean;
  style: string | null;
  counts: FunnelCounts;
  /** Booked per send, 95% Wilson interval. */
  booked: { rate: number; low: number; high: number };
}

export interface ExperimentView {
  id: string;
  name: string;
  slot: string;
  slotLabel: string;
  slotKind: string;
  status: ExperimentFull["status"];
  allocation: ExperimentFull["allocation"];
  minSends: number;
  setterName: string | null;
  winnerVariantId: string | null;
  startedAt: string;
  variants: VariantRow[];
  total: FunnelCounts;
  verdict: Verdict;
  sample: boolean;
}

export interface SlotNames {
  campaigns: Map<string, string>;
  setters: Map<string, string>;
}

export function slotLabel(slot: string, names: SlotNames): { label: string; kind: string } {
  const p = parseSlot(slot);
  if (!p) return { label: slot, kind: "other" };
  if (p.kind === "campaign_opener") return { label: `Opening DM · ${names.campaigns.get(p.ref) ?? "Campaign"}`, kind: "Campaign opener" };
  if (p.kind === "j_opener") return { label: `J's opener · ${ENTRY_PATHS.find((e) => e.key === p.ref)?.label ?? p.ref}`, kind: "J opener" };
  return { label: LINE_KEYS.find((l) => l.key === p.ref)?.label ?? p.ref, kind: "J line" };
}

function sum(rows: FunnelCounts[]): FunnelCounts {
  const t = emptyCounts();
  for (const r of rows) for (const k of Object.keys(t) as (keyof FunnelCounts)[]) t[k] += r[k];
  return t;
}

/** Pure: the view from the experiment and its per-variant counts. */
export function toView(e: ExperimentFull, counts: Map<string, FunnelCounts>, names: SlotNames, sample: boolean): ExperimentView {
  const variants: VariantRow[] = e.variants.map((v) => {
    const c = counts.get(v.id) ?? emptyCounts();
    const ci = wilson(c.booked, c.sent);
    return { ...v, counts: c, booked: { rate: ci.rate, low: ci.low, high: ci.high } };
  });
  const arms = variants.filter((v) => v.active || v.counts.sent > 0).map((v) => ({ id: v.id, label: v.label, sent: v.counts.sent, booked: v.counts.booked }));
  const { label, kind } = slotLabel(e.slot, names);
  return {
    id: e.id,
    name: e.name,
    slot: e.slot,
    slotLabel: label,
    slotKind: kind,
    status: e.status,
    allocation: e.allocation,
    minSends: e.minSends,
    setterName: e.setterId ? (names.setters.get(e.setterId) ?? null) : null,
    winnerVariantId: e.winnerVariantId,
    startedAt: e.startedAt.toISOString(),
    variants,
    total: sum(variants.map((v) => v.counts)),
    verdict: verdict(arms, e.minSends),
    sample,
  };
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** The stage a line belongs to, when the draft that carried it didn't say. */
export function lineStageOf(slot: string): string | null {
  const p = parseSlot(slot);
  if (!p) return null;
  if (p.kind !== "line") return "opener";
  return ({ permission_ask: "permission", qualifying: "qualify", value_offer: "value", invite: "bridge" } as Record<string, string>)[p.ref] ?? null;
}

/** Exposures for one experiment, from the DB. Campaign openers take their
 *  send time from DmLog; J lines from the approved draft (sentAt). */
async function exposures(e: ExperimentFull, rows: AssignmentRow[]): Promise<Exposure[]> {
  if (!rows.length) return [];
  const p = parseSlot(e.slot);
  const sentAt = new Map<string, Date | null>(rows.map((r) => [r.id, r.sentAt]));
  if (p?.kind === "campaign_opener") {
    const logs = await prisma.dmLog.findMany({
      where: { automationId: p.ref, status: "SENT", commenterId: { in: rows.map((r) => r.igUserId) }, NOT: { commentId: { startsWith: "email:" } } },
      select: { commenterId: true, instagramAccountId: true, dmSentAt: true },
    });
    for (const r of rows) {
      // The comment the variant was picked for is sent within a minute or so.
      const from = r.assignedAt.getTime() - 5 * 60_000;
      const hit = logs
        .filter((l) => l.commenterId === r.igUserId && l.instagramAccountId === r.instagramAccountId && l.dmSentAt && l.dmSentAt.getTime() >= from)
        .sort((a, b) => a.dmSentAt!.getTime() - b.dmSentAt!.getTime())[0];
      sentAt.set(r.id, hit?.dmSentAt ?? null);
    }
  }

  const contacts = await prisma.contact.findMany({
    where: {
      workspaceId: e.workspaceId,
      OR: rows.map((r) => (r.contactId ? { id: r.contactId } : { instagramAccountId: r.instagramAccountId, igUserId: r.igUserId })),
    },
    select: { id: true, instagramAccountId: true, igUserId: true, stage: true },
  });
  const ids = contacts.map((c) => c.id);
  const draftIds = rows.map((r) => r.draftId).filter((x): x is string => Boolean(x));
  const [states, drafts, fridays, bookings, carriers] = await Promise.all([
    prisma.setterState.findMany({ where: { contactId: { in: ids } }, select: { contactId: true, record: true } }),
    prisma.draft.findMany({
      where: { contactId: { in: ids }, status: "SENT", kind: { in: ["invite", "booking"] } },
      select: { contactId: true, sentAt: true },
    }),
    prisma.fridaySend.findMany({ where: { contactId: { in: ids }, status: { not: "sending" } }, select: { contactId: true, sentAt: true, createdAt: true } }),
    prisma.booking.findMany({ where: { contactId: { in: ids }, status: { not: "CANCELLED" } }, select: { contactId: true, createdAt: true } }),
    draftIds.length ? prisma.draft.findMany({ where: { id: { in: draftIds } }, select: { id: true, setterStage: true } }) : [],
  ]);
  const stageAt = new Map(carriers.map((d) => [d.id, d.setterStage]));
  const lineStage = lineStageOf(e.slot);
  const group = <T extends { contactId: string }>(list: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of list) m.set(x.contactId, [...(m.get(x.contactId) ?? []), x]);
    return m;
  };
  const stateBy = new Map(states.map((s) => [s.contactId, s.record as unknown as SetterRecord]));
  const draftsBy = group(drafts);
  const fridaysBy = group(fridays);
  const bookingsBy = group(bookings);
  const facts = new Map<string, ContactFacts>();
  for (const c of contacts) {
    facts.set(
      `${c.instagramAccountId}:${c.igUserId}`,
      factsFromRecord(stateBy.get(c.id) ?? null, {
        valueAts: (fridaysBy.get(c.id) ?? []).map((f) => iso(f.sentAt ?? f.createdAt)!),
        inviteAts: (draftsBy.get(c.id) ?? []).map((d) => iso(d.sentAt)).filter((x): x is string => Boolean(x)),
        bookedAts: (bookingsBy.get(c.id) ?? []).map((b) => iso(b.createdAt)!),
        stage: c.stage,
      })
    );
  }
  return rows.map((r) => ({
    variantId: r.variantId,
    sentAt: iso(sentAt.get(r.id)),
    edited: r.edited,
    facts: facts.get(`${r.instagramAccountId}:${r.igUserId}`) ?? null,
    stageAtSend: r.draftId ? (stageAt.get(r.draftId) ?? null) : null,
    lineStage,
  }));
}

async function names(workspaceId: string): Promise<SlotNames> {
  if (osMockEnabled()) {
    return { campaigns: new Map([["sample-automation-1", "Claude Code reel (sample)"]]), setters: new Map() };
  }
  const [automations, setters] = await Promise.all([
    prisma.automation.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
    prisma.setter.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
  ]);
  return { campaigns: new Map(automations.map((a) => [a.id, a.name])), setters: new Map(setters.map((s) => [s.id, s.name])) };
}

async function countsFor(e: ExperimentFull): Promise<{ counts: Map<string, FunnelCounts>; sample: boolean }> {
  const store = experimentStore();
  const rows = await store.assignments(e.id);
  const ids = e.variants.map((v) => v.id);
  if (osMockEnabled()) {
    // Sample numbers are fake; a new experiment on sample data counts only
    // what was approved here (sent, edited).
    const sample = mockSampleCounts(e.id);
    if (sample) return { counts: new Map(Object.entries(sample)), sample: true };
    return {
      counts: byVariant(
        rows.map((r) => ({ variantId: r.variantId, sentAt: iso(r.sentAt), edited: r.edited, facts: null })),
        ids
      ),
      sample: false,
    };
  }
  return { counts: byVariant(await exposures(e, rows), ids), sample: false };
}

export async function listExperiments(workspaceId: string): Promise<ExperimentView[]> {
  const [list, n] = await Promise.all([experimentStore().list(workspaceId), names(workspaceId)]);
  return Promise.all(
    list.map(async (e) => {
      const { counts, sample } = await countsFor(e);
      return toView(e, counts, n, sample);
    })
  );
}

// ---------------------------------------------------------------- line tests
export interface LineVariantView {
  id: string;
  label: string;
  text: string;
  active: boolean;
  counts: FunnelCounts;
}

export interface LineTestView {
  id: string;
  slot: string;
  /** "setter" = all of this setter, "all" = every setter, "workflow" = one workflow. */
  scope: "setter" | "all" | "workflow";
  workflowId: string | null;
  /** A J opener test for one way in (not "any"): its label. */
  entry: string | null;
  status: ExperimentStatusName;
  winnerVariantId: string | null;
  variants: LineVariantView[];
  verdict: LineVerdict;
  sample: boolean;
}

export interface StageLineRow {
  key: StageLineKey;
  label: string;
  /** The setter-wide slot "+ Test" creates. */
  slot: string;
  tests: LineTestView[];
}

const STATUS_ORDER: Record<ExperimentStatusName, number> = { RUNNING: 0, PAUSED: 1, DRAFT: 2, FINISHED: 3 };

/** Pure: one test as the Tests tab shows it. */
export function lineTestView(e: ExperimentFull, counts: Map<string, FunnelCounts>, setterId: string, sample = false): LineTestView {
  const p = parseSlot(e.slot);
  const variants = e.variants.map((v) => ({ id: v.id, label: v.label, text: v.text, active: v.active, counts: counts.get(v.id) ?? emptyCounts() }));
  // A variant that lost (picked winner) still shows, but only arms that can
  // still get people, or already have, are judged.
  const arms = variants
    .filter((v) => v.active || v.counts.sent > 0)
    .map((v) => ({ id: v.id, label: v.label, reached: v.counts.sent, replied: v.counts.replied, booked: v.counts.booked }));
  const entry = p?.kind === "j_opener" && p.ref !== "any" ? (ENTRY_PATHS.find((x) => x.key === p.ref)?.label ?? p.ref) : null;
  return {
    id: e.id,
    slot: e.slot,
    scope: p?.workflowId ? "workflow" : e.setterId === setterId ? "setter" : "all",
    workflowId: p?.workflowId ?? null,
    entry,
    status: e.status,
    winnerVariantId: e.winnerVariantId,
    variants,
    verdict: lineVerdict(arms),
    sample,
  };
}

/** Pure: the six stage lines with this setter's tests (not stopped ones). */
export function stageLineRows(tests: { e: ExperimentFull; view: LineTestView }[]): StageLineRow[] {
  return STAGE_LINES.map((l) => ({
    key: l.key,
    label: l.label,
    slot: l.slot,
    tests: tests
      .filter((t) => t.e.status !== "FINISHED" && stageLineOf(t.e.slot)?.key === l.key)
      .sort((a, b) => STATUS_ORDER[a.e.status] - STATUS_ORDER[b.e.status])
      .map((t) => t.view),
  }));
}

/** Knowledge bases › setter › Tests. */
export async function loadLineTests(workspaceId: string, setterId: string): Promise<StageLineRow[]> {
  const list = (await experimentStore().list(workspaceId)).filter((e) => stageLineOf(e.slot) && e.status !== "FINISHED" && (!e.setterId || e.setterId === setterId));
  const tests = await Promise.all(
    list.map(async (e) => {
      const { counts, sample } = await countsFor(e);
      return { e, view: lineTestView(e, counts, setterId, sample) };
    })
  );
  return stageLineRows(tests);
}

/** Pure: the campaign row's A/B note. */
export function openerSummary(e: ExperimentFull, counts: Map<string, FunnelCounts>): string {
  const arms = e.variants
    .map((v) => ({ v, c: counts.get(v.id) ?? emptyCounts() }))
    .filter((x) => x.v.active || x.c.sent > 0)
    .map((x) => ({ id: x.v.id, label: x.v.label, reached: x.c.sent, replied: x.c.replied, booked: x.c.booked }));
  const v = lineVerdict(arms);
  if (v.kind !== "leader" && v.kind !== "tie") return "A/B · too early";
  const rates = arms.map((a) => `${a.label} ${pct(a[v.metric === "booked" ? "booked" : "replied"] / Math.max(1, a.reached))}`).join(" · ");
  return `A/B ${v.metric === "booked" ? "booked" : "replied"} · ${rates}`;
}

/** Running campaign opener tests, per campaign id: the row's A/B note. */
export async function openerSummaries(workspaceId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const list = (await experimentStore().list(workspaceId)).filter((e) => e.status === "RUNNING" && parseSlot(e.slot)?.kind === "campaign_opener");
  for (const e of list) {
    try {
      const { counts } = await countsFor(e);
      out.set(parseSlot(baseSlot(e.slot))!.ref, openerSummary(e, counts));
    } catch (err) {
      console.error("[OS Experiments] opener summary:", err instanceof Error ? err.message : err);
    }
  }
  return out;
}
