// Loading experiments for /os/automations/tests: each variant's funnel,
// counted from existing data (funnel.ts), plus the confidence hint (stats.ts).

import { prisma } from "@/lib/db/client";
import { osMockEnabled } from "@/lib/os/mock";
import { byVariant, emptyCounts, factsFromRecord, type ContactFacts, type Exposure, type FunnelCounts } from "@/lib/os/experiments/funnel";
import { verdict, wilson, type Verdict } from "@/lib/os/experiments/stats";
import { experimentStore, mockSampleCounts, type AssignmentRow, type ExperimentFull } from "@/lib/os/experiments/store";
import { ENTRY_PATHS, LINE_KEYS, parseSlot } from "@/lib/os/experiments/types";
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
  const [states, drafts, fridays, bookings] = await Promise.all([
    prisma.setterState.findMany({ where: { contactId: { in: ids } }, select: { contactId: true, record: true } }),
    prisma.draft.findMany({
      where: { contactId: { in: ids }, status: "SENT", kind: { in: ["invite", "booking"] } },
      select: { contactId: true, sentAt: true },
    }),
    prisma.fridaySend.findMany({ where: { contactId: { in: ids }, status: { not: "sending" } }, select: { contactId: true, sentAt: true, createdAt: true } }),
    prisma.booking.findMany({ where: { contactId: { in: ids }, status: { not: "CANCELLED" } }, select: { contactId: true, createdAt: true } }),
  ]);
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

export interface CreateOptions {
  campaigns: { id: string; name: string; openingDm: string | null }[];
  setters: { id: string; name: string }[];
  /** Slots that already have a running experiment (one at a time per slot). */
  busySlots: string[];
}

export async function createOptions(workspaceId: string): Promise<CreateOptions> {
  const running = (await experimentStore().list(workspaceId)).filter((e) => e.status === "RUNNING").map((e) => e.slot);
  if (osMockEnabled()) {
    const real = await prisma.automation
      .findMany({ where: { workspaceId }, select: { id: true, name: true, openingDmEnabled: true, openingDmMessage: true } })
      .catch(() => []);
    return {
      campaigns: [
        { id: "sample-automation-1", name: "Claude Code reel (sample)", openingDm: "hey, appreciate you commenting! want the guide?" },
        ...real.map((a) => ({ id: a.id, name: a.name, openingDm: a.openingDmEnabled ? a.openingDmMessage : null })),
      ],
      setters: [],
      busySlots: running,
    };
  }
  const [automations, setters] = await Promise.all([
    prisma.automation.findMany({
      where: { workspaceId },
      select: { id: true, name: true, openingDmEnabled: true, openingDmMessage: true, openingDmButtonLabel: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.setter.findMany({ where: { workspaceId }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
  ]);
  return {
    campaigns: automations.map((a) => ({
      id: a.id,
      name: a.name,
      // The worker only sends an opening DM with all three set.
      openingDm: a.openingDmEnabled && a.openingDmMessage && a.openingDmButtonLabel ? a.openingDmMessage : null,
    })),
    setters,
    busySlots: running,
  };
}
