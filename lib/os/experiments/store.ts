// Where experiments live: Postgres (Experiment, Variant, Assignment) or, with
// OS_MOCK=1, an in-memory copy seeded with sample experiments (mock.ts) so the
// screen and the Draft → Approve attribution can be clicked through locally.

import { prisma } from "@/lib/db/client";
import { osMockEnabled } from "@/lib/os/mock";
import { mockSeed, type MockExperiment } from "@/lib/os/experiments/mock";
import type { AllocationName, ExperimentLite, ExperimentStatusName } from "@/lib/os/experiments/types";

export interface Person {
  workspaceId: string;
  /** Our InstagramAccount.id ("mock" on sample data). */
  instagramAccountId: string;
  igUserId: string;
  contactId?: string | null;
}

export interface AssignmentRow {
  id: string;
  experimentId: string;
  variantId: string;
  instagramAccountId: string;
  igUserId: string;
  contactId: string | null;
  assignedAt: Date;
  sentAt: Date | null;
  draftId: string | null;
  edited: boolean;
}

export interface NewExperiment {
  workspaceId: string;
  setterId: string | null;
  name: string;
  slot: string;
  allocation: AllocationName;
  minSends: number;
  variants: { label: string; text: string; weight: number; style: string | null }[];
}

export interface ExperimentFull extends ExperimentLite {
  minSends: number;
  winnerVariantId: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  variants: (ExperimentLite["variants"][number] & { style: string | null })[];
  /** OS_MOCK sample: the numbers are made up. */
  sample?: boolean;
}

export interface ExperimentStore {
  running(workspaceId: string, slots: string[]): Promise<ExperimentLite[]>;
  findAssignment(experimentId: string, p: Person): Promise<AssignmentRow | null>;
  /** Creates it, or returns the one a racing call made first (the unique key). */
  createAssignment(experimentId: string, variantId: string, p: Person): Promise<AssignmentRow>;
  /** First send only: a later draft never moves sentAt. */
  markSent(experimentId: string, p: Person, sent: { draftId: string | null; at: Date; edited: boolean; text: string }): Promise<void>;
  list(workspaceId: string): Promise<ExperimentFull[]>;
  get(workspaceId: string, id: string): Promise<ExperimentFull | null>;
  create(input: NewExperiment): Promise<ExperimentFull>;
  setStatus(workspaceId: string, id: string, status: ExperimentStatusName): Promise<boolean>;
  /** The winner becomes the only active variant: everyone new gets it (the
   *  test keeps running so the slot keeps using it); people who already had
   *  another variant keep theirs. */
  pickWinner(workspaceId: string, id: string, variantId: string): Promise<boolean>;
  assignments(experimentId: string): Promise<AssignmentRow[]>;
}

// ---------------------------------------------------------------- Postgres
const fullInclude = { variants: { orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }] } };

type FullRow = Awaited<ReturnType<typeof prisma.experiment.findFirst<{ include: typeof fullInclude }>>>;

function full(e: NonNullable<FullRow>): ExperimentFull {
  return {
    id: e.id,
    workspaceId: e.workspaceId,
    setterId: e.setterId,
    name: e.name,
    slot: e.slot,
    status: e.status,
    allocation: e.allocation,
    minSends: e.minSends,
    winnerVariantId: e.winnerVariantId,
    startedAt: e.startedAt,
    finishedAt: e.finishedAt,
    variants: e.variants.map((v) => ({ id: v.id, label: v.label, text: v.text, weight: v.weight, active: v.active, style: v.style })),
  };
}

const personKey = (experimentId: string, p: Person) => ({
  experimentId_instagramAccountId_igUserId: { experimentId, instagramAccountId: p.instagramAccountId, igUserId: p.igUserId },
});

const dbExperiments: ExperimentStore = {
  async running(workspaceId, slots) {
    if (!slots.length) return [];
    const rows = await prisma.experiment.findMany({
      where: { workspaceId, status: "RUNNING", slot: { in: slots } },
      include: fullInclude,
      orderBy: { createdAt: "asc" },
    });
    return rows.map(full);
  },
  async findAssignment(experimentId, p) {
    return prisma.assignment.findUnique({ where: personKey(experimentId, p) });
  },
  async createAssignment(experimentId, variantId, p) {
    try {
      return await prisma.assignment.create({
        data: {
          workspaceId: p.workspaceId,
          experimentId,
          variantId,
          instagramAccountId: p.instagramAccountId,
          igUserId: p.igUserId,
          contactId: p.contactId ?? null,
        },
      });
    } catch (err) {
      const existing = await prisma.assignment.findUnique({ where: personKey(experimentId, p) });
      if (existing) return existing;
      throw err;
    }
  },
  async markSent(experimentId, p, sent) {
    await prisma.assignment.updateMany({
      where: { experimentId, instagramAccountId: p.instagramAccountId, igUserId: p.igUserId, sentAt: null },
      data: {
        sentAt: sent.at,
        draftId: sent.draftId,
        edited: sent.edited,
        sentText: sent.text.slice(0, 2000),
        ...(p.contactId ? { contactId: p.contactId } : {}),
      },
    });
  },
  async list(workspaceId) {
    const rows = await prisma.experiment.findMany({ where: { workspaceId }, include: fullInclude, orderBy: { createdAt: "desc" } });
    return rows.map(full);
  },
  async get(workspaceId, id) {
    const e = await prisma.experiment.findFirst({ where: { id, workspaceId }, include: fullInclude });
    return e ? full(e) : null;
  },
  async create(input) {
    const e = await prisma.experiment.create({
      data: {
        workspaceId: input.workspaceId,
        setterId: input.setterId,
        name: input.name,
        slot: input.slot,
        allocation: input.allocation,
        minSends: input.minSends,
        variants: { create: input.variants.map((v, i) => ({ ...v, sortOrder: i })) },
      },
      include: fullInclude,
    });
    return full(e);
  },
  async setStatus(workspaceId, id, status) {
    const r = await prisma.experiment.updateMany({
      where: { id, workspaceId },
      data: { status, finishedAt: status === "FINISHED" ? new Date() : null },
    });
    return r.count === 1;
  },
  async pickWinner(workspaceId, id, variantId) {
    const e = await prisma.experiment.findFirst({ where: { id, workspaceId }, select: { id: true, variants: { select: { id: true } } } });
    if (!e || !e.variants.some((v) => v.id === variantId)) return false;
    await prisma.$transaction([
      prisma.variant.updateMany({ where: { experimentId: id }, data: { active: false } }),
      prisma.variant.update({ where: { id: variantId }, data: { active: true } }),
      prisma.experiment.update({ where: { id }, data: { winnerVariantId: variantId } }),
    ]);
    return true;
  },
  async assignments(experimentId) {
    return prisma.assignment.findMany({ where: { experimentId } });
  },
};

// ---------------------------------------------------------------- OS_MOCK
interface MockDb {
  experiments: MockExperiment[];
  assignments: AssignmentRow[];
  seq: number;
  seeded: boolean;
}

const mem = ((globalThis as { __osExperimentsMock?: MockDb }).__osExperimentsMock ??= {
  experiments: [],
  assignments: [],
  seq: 0,
  seeded: false,
});

function seed(workspaceId: string) {
  if (mem.seeded) return;
  mem.seeded = true;
  mem.experiments.push(...mockSeed(workspaceId));
}

const strip = (e: MockExperiment): ExperimentFull => {
  const { sampleCounts: _counts, ...rest } = e;
  void _counts;
  return { ...rest, variants: rest.variants.map((v) => ({ ...v })) };
};

const mockExperiments: ExperimentStore = {
  async running(workspaceId, slots) {
    seed(workspaceId);
    return mem.experiments.filter((e) => e.status === "RUNNING" && slots.includes(e.slot)).map(strip);
  },
  async findAssignment(experimentId, p) {
    return mem.assignments.find((a) => a.experimentId === experimentId && a.instagramAccountId === p.instagramAccountId && a.igUserId === p.igUserId) ?? null;
  },
  async createAssignment(experimentId, variantId, p) {
    const existing = await this.findAssignment(experimentId, p);
    if (existing) return existing;
    const row: AssignmentRow = {
      id: `mock-asg-${++mem.seq}`,
      experimentId,
      variantId,
      instagramAccountId: p.instagramAccountId,
      igUserId: p.igUserId,
      contactId: p.contactId ?? null,
      assignedAt: new Date(),
      sentAt: null,
      draftId: null,
      edited: false,
    };
    mem.assignments.push(row);
    return row;
  },
  async markSent(experimentId, p, sent) {
    const a = await this.findAssignment(experimentId, p);
    if (a && !a.sentAt) Object.assign(a, { sentAt: sent.at, draftId: sent.draftId, edited: sent.edited });
  },
  async list(workspaceId) {
    seed(workspaceId);
    return [...mem.experiments].reverse().map(strip);
  },
  async get(workspaceId, id) {
    seed(workspaceId);
    const e = mem.experiments.find((x) => x.id === id);
    return e ? { ...strip(e), sample: Boolean(e.sampleCounts) } : null;
  },
  async create(input) {
    const id = `mock-exp-${++mem.seq}`;
    const e: MockExperiment = {
      id,
      workspaceId: input.workspaceId,
      setterId: input.setterId,
      name: input.name,
      slot: input.slot,
      status: "RUNNING",
      allocation: input.allocation,
      minSends: input.minSends,
      winnerVariantId: null,
      startedAt: new Date(),
      finishedAt: null,
      variants: input.variants.map((v, i) => ({ id: `${id}-v${i + 1}`, label: v.label, text: v.text, weight: v.weight, active: true, style: v.style })),
      sampleCounts: null,
    };
    mem.experiments.push(e);
    return strip(e);
  },
  async setStatus(_workspaceId, id, status) {
    const e = mem.experiments.find((x) => x.id === id);
    if (!e) return false;
    e.status = status;
    e.finishedAt = status === "FINISHED" ? new Date() : null;
    return true;
  },
  async pickWinner(_workspaceId, id, variantId) {
    const e = mem.experiments.find((x) => x.id === id);
    if (!e || !e.variants.some((v) => v.id === variantId)) return false;
    for (const v of e.variants) v.active = v.id === variantId;
    e.winnerVariantId = variantId;
    return true;
  },
  async assignments(experimentId) {
    return mem.assignments.filter((a) => a.experimentId === experimentId);
  },
};

/** The fake funnel numbers on a sample experiment, per variant id. */
export function mockSampleCounts(experimentId: string) {
  return mem.experiments.find((e) => e.id === experimentId)?.sampleCounts ?? null;
}

export function experimentStore(): ExperimentStore {
  return osMockEnabled() ? mockExperiments : dbExperiments;
}
