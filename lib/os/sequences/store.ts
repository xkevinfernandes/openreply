// Where follow-ups live: the setter's sequences (FollowupSequence), the queue
// and its history (FollowupStep), Kevin's tasks (OsTask) and call attendance
// (Booking). Postgres, or in memory with OS_MOCK=1 so the whole flow can be
// clicked through on the sample inbox.
//
// The one-live-step rule is enforced here, not trusted to callers: queue()
// cancels whatever is live for the contact in the same transaction, and the
// unique liveContactId column refuses a second live row even under a race.

import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { osMockEnabled } from "@/lib/os/mock";
import { mockBookingRows } from "@/lib/os/setter/booking-store";
import { defaultSetterId } from "@/lib/os/setter/setters";
import type { PlanBooking, StepHistory, StepStatusName } from "@/lib/os/sequences/plan";
import { cleanSequence, resolveSequenceSet, type Sequence, type SequenceSet, type SequenceStep } from "@/lib/os/sequences/types";

export interface StepRow extends StepHistory {
  id: string;
  workspaceId: string;
  contactId: string;
  setterId: string | null;
  stepIndex: number;
  dueAt: string;
  step: SequenceStep;
  draftId: string | null;
  bookingId: string | null;
  createdAt: string;
}

export interface NewStep {
  workspaceId: string;
  contactId: string;
  setterId: string | null;
  sequence: string;
  stepId: string;
  stepIndex: number;
  episode: string;
  key: string;
  dueAt: string;
  step: SequenceStep;
  bookingId: string | null;
}

export interface StepPatch {
  status?: StepStatusName;
  reason?: string | null;
  draftId?: string | null;
  dueAt?: string;
  step?: SequenceStep;
}

export interface TaskContext {
  goal: string | null;
  pain: string | null;
  notes: string | null;
  /** Their last few messages, newest last. */
  lastWords: string[];
  callAt: string | null;
}

export interface TaskRow {
  id: string;
  workspaceId: string;
  contactId: string;
  kind: string;
  title: string;
  context: TaskContext;
  status: "OPEN" | "DONE" | "DISMISSED";
  bookingId: string | null;
  createdAt: string;
  doneAt: string | null;
}

export interface NewTask {
  workspaceId: string;
  contactId: string;
  kind: string;
  title: string;
  context: TaskContext;
  dedupeKey: string;
  bookingId: string | null;
}

export type AttendanceName = "SHOWED" | "NO_SHOW";

export interface SequenceStore {
  /** The setter's sequences (the IG account's default setter when null). */
  loadSet(workspaceId: string, setterId: string | null, igAccountId?: string | null): Promise<{ setterId: string | null; set: SequenceSet }>;
  saveSequence(workspaceId: string, setterId: string, seq: Sequence): Promise<void>;
  /** Every step for the contact, oldest first. */
  history(contactId: string): Promise<StepRow[]>;
  getStep(stepId: string, workspaceId?: string): Promise<StepRow | null>;
  /** Cancel what's live for the contact (reason given) and queue this step.
   *  Idempotent per key: a key that already ran is never queued again. */
  queue(input: NewStep, cancelReason: string): Promise<StepRow | null>;
  update(stepId: string, patch: StepPatch): Promise<void>;
  /** Live (queued or drafted) steps, soonest first. */
  listLive(workspaceId: string, opts?: { contactIds?: string[]; sequence?: string }): Promise<StepRow[]>;
  followupsOff(contactId: string): Promise<boolean>;
  setFollowupsOff(workspaceId: string, contactId: string, off: boolean): Promise<void>;
  /** Their latest call, cancelled ones included. */
  latestBooking(workspaceId: string, contactId: string): Promise<PlanBooking | null>;
  setAttendance(workspaceId: string, bookingId: string, attendance: AttendanceName | null, source: string, at: Date): Promise<void>;
  createTask(input: NewTask): Promise<TaskRow>;
  listTasks(workspaceId: string, opts?: { contactId?: string; open?: boolean }): Promise<TaskRow[]>;
  setTaskStatus(workspaceId: string, taskId: string, status: TaskRow["status"]): Promise<boolean>;
}

const LIVE: StepStatusName[] = ["QUEUED", "DRAFTED"];
const isLive = (s: StepStatusName) => LIVE.includes(s);

function asContext(v: unknown): TaskContext {
  const c = (v && typeof v === "object" ? v : {}) as Partial<TaskContext>;
  return {
    goal: typeof c.goal === "string" ? c.goal : null,
    pain: typeof c.pain === "string" ? c.pain : null,
    notes: typeof c.notes === "string" ? c.notes : null,
    lastWords: Array.isArray(c.lastWords) ? c.lastWords.filter((x): x is string => typeof x === "string").slice(-3) : [],
    callAt: typeof c.callAt === "string" ? c.callAt : null,
  };
}

// ---------------------------------------------------------------- sequences (Postgres, also on sample data)
async function loadSet(workspaceId: string, setterId: string | null, igAccountId?: string | null) {
  const id = setterId ?? (await defaultSetterId(workspaceId, igAccountId).catch(() => null));
  if (!id) return { setterId: null, set: resolveSequenceSet([]) };
  const rows = await prisma.followupSequence.findMany({ where: { setterId: id, workspaceId } }).catch(() => []);
  return { setterId: id, set: resolveSequenceSet(rows) };
}

async function saveSequence(workspaceId: string, setterId: string, seq: Sequence) {
  const clean = cleanSequence(seq.key, seq);
  const data = { enabled: clean.enabled, steps: clean.steps as unknown as Prisma.InputJsonValue };
  await prisma.followupSequence.upsert({
    where: { setterId_key: { setterId, key: clean.key } },
    create: { workspaceId, setterId, key: clean.key, ...data },
    update: data,
  });
}

// ---------------------------------------------------------------- Postgres
type StepDb = Prisma.FollowupStepGetPayload<object>;

function stepView(r: StepDb): StepRow {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    contactId: r.contactId,
    setterId: r.setterId,
    sequence: r.sequence,
    stepId: r.stepId,
    stepIndex: r.stepIndex,
    episode: r.episode,
    key: r.key,
    dueAt: r.dueAt.toISOString(),
    status: r.status,
    step: r.step as unknown as SequenceStep,
    draftId: r.draftId,
    bookingId: r.bookingId,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
    doneAt: r.doneAt?.toISOString() ?? null,
  };
}

type TaskDb = Prisma.OsTaskGetPayload<object>;

function taskView(t: TaskDb): TaskRow {
  return {
    id: t.id,
    workspaceId: t.workspaceId,
    contactId: t.contactId,
    kind: t.kind,
    title: t.title,
    context: asContext(t.context),
    status: t.status,
    bookingId: t.bookingId,
    createdAt: t.createdAt.toISOString(),
    doneAt: t.doneAt?.toISOString() ?? null,
  };
}

function patchData(patch: StepPatch, contactId: string): Prisma.FollowupStepUpdateInput {
  const data: Prisma.FollowupStepUpdateInput = {};
  if (patch.status) {
    data.status = patch.status;
    data.liveContactId = isLive(patch.status) ? contactId : null;
    data.doneAt = isLive(patch.status) ? null : new Date();
  }
  if (patch.reason !== undefined) data.reason = patch.reason?.slice(0, 300) ?? null;
  if (patch.draftId !== undefined) data.draftId = patch.draftId;
  if (patch.dueAt) data.dueAt = new Date(patch.dueAt);
  if (patch.step) data.step = patch.step as unknown as Prisma.InputJsonValue;
  return data;
}

const dbStore: SequenceStore = {
  loadSet,
  saveSequence,
  async history(contactId) {
    const rows = await prisma.followupStep.findMany({ where: { contactId }, orderBy: { createdAt: "asc" }, take: 300 });
    return rows.map(stepView);
  },
  async getStep(stepId, workspaceId) {
    const r = await prisma.followupStep.findFirst({ where: { id: stepId, ...(workspaceId ? { workspaceId } : {}) } });
    return r ? stepView(r) : null;
  },
  async queue(input, cancelReason) {
    try {
      const row = await prisma.$transaction(async (tx) => {
        const existing = await tx.followupStep.findUnique({ where: { key: input.key } });
        if (existing && existing.status !== "CANCELLED") return isLive(existing.status) ? existing : null;
        await tx.followupStep.updateMany({
          where: { liveContactId: input.contactId, key: { not: input.key } },
          data: { status: "CANCELLED", reason: cancelReason, liveContactId: null, doneAt: new Date() },
        });
        const data = {
          setterId: input.setterId,
          sequence: input.sequence,
          stepId: input.stepId,
          stepIndex: input.stepIndex,
          episode: input.episode,
          dueAt: new Date(input.dueAt),
          status: "QUEUED" as const,
          liveContactId: input.contactId,
          step: input.step as unknown as Prisma.InputJsonValue,
          bookingId: input.bookingId,
          draftId: null,
          reason: null,
          doneAt: null,
        };
        // A step the engine cancelled (not Kevin) comes back with the same key.
        return existing
          ? tx.followupStep.update({ where: { id: existing.id }, data })
          : tx.followupStep.create({ data: { ...data, workspaceId: input.workspaceId, contactId: input.contactId, key: input.key } });
      });
      return row ? stepView(row) : null;
    } catch (err) {
      // Someone else queued for this contact at the same moment: theirs stands.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return null;
      throw err;
    }
  },
  async update(stepId, patch) {
    const row = await prisma.followupStep.findUnique({ where: { id: stepId }, select: { contactId: true } });
    if (!row) return;
    await prisma.followupStep.update({ where: { id: stepId }, data: patchData(patch, row.contactId) });
  },
  async listLive(workspaceId, opts = {}) {
    const rows = await prisma.followupStep.findMany({
      where: {
        workspaceId,
        status: { in: LIVE },
        ...(opts.contactIds ? { contactId: { in: opts.contactIds } } : {}),
        ...(opts.sequence ? { sequence: opts.sequence } : {}),
      },
      orderBy: { dueAt: "asc" },
      take: 500,
    });
    return rows.map(stepView);
  },
  async followupsOff(contactId) {
    const c = await prisma.contact.findUnique({ where: { id: contactId }, select: { followupsOff: true } });
    return c?.followupsOff ?? false;
  },
  async setFollowupsOff(workspaceId, contactId, off) {
    await prisma.contact.updateMany({ where: { id: contactId, workspaceId }, data: { followupsOff: off } });
  },
  async latestBooking(workspaceId, contactId) {
    const b = await prisma.booking.findFirst({ where: { workspaceId, contactId }, orderBy: { createdAt: "desc" } });
    if (!b) return null;
    return {
      id: b.id,
      start: b.start.toISOString(),
      end: b.end?.toISOString() ?? null,
      timezone: b.timezone,
      status: b.status,
      attendance: b.attendance,
      createdAt: b.createdAt.toISOString(),
      cancelledAt: b.cancelledAt?.toISOString() ?? null,
    };
  },
  async setAttendance(workspaceId, bookingId, attendance, source, at) {
    // Through the one stage writer (cause booking): attendance moves the card.
    const { writeAttendance } = await import("@/lib/os/stage-writer");
    await writeAttendance({ workspaceId, bookingId, attendance, source, at });
  },
  async createTask(input) {
    const t = await prisma.osTask.upsert({
      where: { dedupeKey: input.dedupeKey },
      create: { ...input, context: input.context as unknown as Prisma.InputJsonValue },
      update: {},
    });
    return taskView(t);
  },
  async listTasks(workspaceId, opts = {}) {
    const rows = await prisma.osTask.findMany({
      where: { workspaceId, ...(opts.contactId ? { contactId: opts.contactId } : {}), ...(opts.open ? { status: "OPEN" } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return rows.map(taskView);
  },
  async setTaskStatus(workspaceId, taskId, status) {
    const r = await prisma.osTask.updateMany({ where: { id: taskId, workspaceId }, data: { status, doneAt: status === "OPEN" ? null : new Date() } });
    return r.count === 1;
  },
};

// ---------------------------------------------------------------- OS_MOCK
interface MockSeq {
  steps: Map<string, StepRow>;
  tasks: Map<string, TaskRow & { dedupeKey: string }>;
  off: Set<string>;
  seq: number;
}

const mem = ((globalThis as { __osMockSequences?: MockSeq }).__osMockSequences ??= {
  steps: new Map(),
  tasks: new Map(),
  off: new Set(),
  seq: 0,
});

function applyPatch(row: StepRow, patch: StepPatch) {
  if (patch.status) {
    row.status = patch.status;
    row.doneAt = isLive(patch.status) ? null : new Date().toISOString();
  }
  if (patch.reason !== undefined) row.reason = patch.reason;
  if (patch.draftId !== undefined) row.draftId = patch.draftId;
  if (patch.dueAt) row.dueAt = patch.dueAt;
  if (patch.step) row.step = patch.step;
}

const mockStore: SequenceStore = {
  loadSet,
  saveSequence,
  async history(contactId) {
    return [...mem.steps.values()].filter((s) => s.contactId === contactId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },
  async getStep(stepId) {
    return mem.steps.get(stepId) ?? null;
  },
  async queue(input, cancelReason) {
    const existing = [...mem.steps.values()].find((s) => s.key === input.key);
    if (existing && existing.status !== "CANCELLED") return isLive(existing.status) ? existing : null;
    for (const s of mem.steps.values()) {
      if (s.contactId === input.contactId && isLive(s.status) && s.key !== input.key) applyPatch(s, { status: "CANCELLED", reason: cancelReason });
    }
    const now = new Date().toISOString();
    const row: StepRow = {
      ...(existing ?? { id: `mock-step-${++mem.seq}`, createdAt: now }),
      ...input,
      status: "QUEUED",
      draftId: null,
      reason: null,
      doneAt: null,
    } as StepRow;
    mem.steps.set(row.id, row);
    return row;
  },
  async update(stepId, patch) {
    const row = mem.steps.get(stepId);
    if (row) applyPatch(row, patch);
  },
  async listLive(_workspaceId, opts = {}) {
    return [...mem.steps.values()]
      .filter((s) => isLive(s.status) && (!opts.contactIds || opts.contactIds.includes(s.contactId)) && (!opts.sequence || s.sequence === opts.sequence))
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  },
  async followupsOff(contactId) {
    return mem.off.has(contactId);
  },
  async setFollowupsOff(_workspaceId, contactId, off) {
    if (off) mem.off.add(contactId);
    else mem.off.delete(contactId);
  },
  async latestBooking(_workspaceId, contactId) {
    const b = [...mockBookingRows().values()].reverse().find((x) => x.contactId === contactId);
    if (!b) return null;
    return {
      id: b.id,
      start: b.start,
      end: b.end,
      timezone: b.timezone,
      status: b.status,
      attendance: b.attendance ?? null,
      createdAt: b.createdAt ?? new Date(new Date(b.start).getTime() - 2 * 86_400_000).toISOString(),
      cancelledAt: b.cancelledAt ?? null,
    };
  },
  async setAttendance(_workspaceId, bookingId, attendance, source, at) {
    const b = mockBookingRows().get(bookingId);
    if (b) Object.assign(b, { attendance, attendanceSource: attendance ? source : null, attendanceAt: attendance ? at.toISOString() : null });
  },
  async createTask(input) {
    const found = [...mem.tasks.values()].find((t) => t.dedupeKey === input.dedupeKey);
    if (found) return found;
    const t = { ...input, id: `mock-task-${++mem.seq}`, status: "OPEN" as const, createdAt: new Date().toISOString(), doneAt: null };
    mem.tasks.set(t.id, t);
    return t;
  },
  async listTasks(_workspaceId, opts = {}) {
    return [...mem.tasks.values()]
      .filter((t) => (!opts.contactId || t.contactId === opts.contactId) && (!opts.open || t.status === "OPEN"))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async setTaskStatus(_workspaceId, taskId, status) {
    const t = mem.tasks.get(taskId);
    if (!t) return false;
    Object.assign(t, { status, doneAt: status === "OPEN" ? null : new Date().toISOString() });
    return true;
  },
};

export function sequenceStore(): SequenceStore {
  return osMockEnabled() ? mockStore : dbStore;
}

/** For tests: a fresh in-memory store with the same rules as the mock one. */
export function memorySequenceStore(opts: { sets?: Record<string, SequenceSet>; bookings?: Map<string, PlanBooking & { contactId: string }> } = {}): SequenceStore & {
  steps: Map<string, StepRow>;
  tasks: Map<string, TaskRow>;
} {
  const steps = new Map<string, StepRow>();
  const tasks = new Map<string, TaskRow & { dedupeKey: string }>();
  const off = new Set<string>();
  const bookings = opts.bookings ?? new Map<string, PlanBooking & { contactId: string }>();
  let n = 0;
  const inner: SequenceStore = {
    async loadSet(_w, setterId) {
      return { setterId, set: (setterId && opts.sets?.[setterId]) || opts.sets?.default || resolveSequenceSet([]) };
    },
    async saveSequence() {},
    async history(contactId) {
      return [...steps.values()].filter((s) => s.contactId === contactId);
    },
    async getStep(id) {
      return steps.get(id) ?? null;
    },
    async queue(input, cancelReason) {
      const existing = [...steps.values()].find((s) => s.key === input.key);
      if (existing && existing.status !== "CANCELLED") return isLive(existing.status) ? existing : null;
      for (const s of steps.values()) if (s.contactId === input.contactId && isLive(s.status) && s.key !== input.key) applyPatch(s, { status: "CANCELLED", reason: cancelReason });
      const row = {
        ...(existing ?? { id: `s${++n}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString() }),
        ...input,
        status: "QUEUED",
        draftId: null,
        reason: null,
        doneAt: null,
      } as StepRow;
      steps.set(row.id, row);
      return row;
    },
    async update(id, patch) {
      const row = steps.get(id);
      if (row) applyPatch(row, patch);
    },
    async listLive(_w, o = {}) {
      return [...steps.values()].filter((s) => isLive(s.status) && (!o.contactIds || o.contactIds.includes(s.contactId)));
    },
    async followupsOff(id) {
      return off.has(id);
    },
    async setFollowupsOff(_w, id, v) {
      if (v) off.add(id);
      else off.delete(id);
    },
    async latestBooking(_w, contactId) {
      return [...bookings.values()].reverse().find((b) => b.contactId === contactId) ?? null;
    },
    async setAttendance(_w, id, attendance) {
      const b = bookings.get(id);
      if (b) b.attendance = attendance;
    },
    async createTask(input) {
      const found = [...tasks.values()].find((t) => t.dedupeKey === input.dedupeKey);
      if (found) return found;
      const t = { ...input, id: `t${++n}`, status: "OPEN" as const, createdAt: new Date().toISOString(), doneAt: null };
      tasks.set(t.id, t);
      return t;
    },
    async listTasks(_w, o = {}) {
      return [...tasks.values()].filter((t) => (!o.contactId || t.contactId === o.contactId) && (!o.open || t.status === "OPEN"));
    },
    async setTaskStatus(_w, id, status) {
      const t = tasks.get(id);
      if (!t) return false;
      t.status = status;
      return true;
    },
  };
  return Object.assign(inner, { steps, tasks });
}
