import { prisma } from "@/lib/db/client";
import { followupsDue } from "@/lib/os/followups-data";
import { stageLabels, stageOrder } from "@/lib/os/labels";
import { mockMessages, mockThreads, osMockEnabled } from "@/lib/os/mock";
import { getSetterConfig } from "@/lib/os/setter/config";
import { pendingDrafts } from "@/lib/os/setter/service";
import { windowState, type SetterRecord, type StateConfig } from "@/lib/os/setter/state";

const DAY = 24 * 60 * 60 * 1000;

export async function getHomeStats(workspaceId: string) {
  const now = new Date();
  const since = new Date(now.getTime() - 7 * DAY);
  const [activeCampaigns, dmsSent, sales, unsorted] = await Promise.all([
    prisma.automation.count({ where: { workspaceId, isActive: true } }),
    prisma.dmLog.count({ where: { workspaceId, status: "SENT", dmSentAt: { gte: since } } }),
    prisma.contact.count({ where: { workspaceId, kind: "SALES" } }),
    prisma.contact.count({ where: { workspaceId, kind: "UNSORTED" } }),
  ]);

  return {
    today: now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }),
    stats: [
      { label: "Active automations", value: activeCampaigns },
      { label: "DMs sent, last 7 days", value: dmsSent },
      { label: "Sales contacts", value: sales },
      { label: "Unsorted contacts", value: unsorted },
    ],
  };
}

// --- Setter funnel (V1-1) ------------------------------------------------------

/** J's six setting stages, in order. */
export const J_STAGES = [
  { key: "opener", label: "Opener" },
  { key: "value", label: "Value" },
  { key: "permission", label: "Permission" },
  { key: "qualify", label: "Qualify" },
  { key: "bridge", label: "Bridge" },
  { key: "booked", label: "Booked" },
] as const;

export interface Bar {
  key: string;
  label: string;
  count: number;
}

export interface SetterOverview {
  draftsWaiting: number;
  /** They wrote last and the free 24h window is still open. */
  windowsClosing: number;
  /** The soonest of those windows to close (ISO). */
  nextClose: string | null;
  followupsDue: number;
  funnel: Bar[];
  pipeline: Bar[];
}

export interface AwaitingRow {
  theirLastAt: string | null;
  ourLastAt: string | null;
}

/** Pure: how many "you owe a reply" threads still have the free window, and the soonest close. */
export function closingWindows(rows: AwaitingRow[], now: Date, cfg?: StateConfig): { count: number; nextClose: string | null } {
  let count = 0;
  let next: string | null = null;
  for (const r of rows) {
    if (!r.theirLastAt || (r.ourLastAt && r.ourLastAt >= r.theirLastAt)) continue;
    const [win, until] = windowState(r.theirLastAt, now, cfg);
    if (win !== "free") continue;
    count++;
    if (until && (!next || until < next)) next = until;
  }
  return { count, nextClose: next };
}

/** Pure: counts in a fixed key order (unknown keys dropped). */
export function countBars(keys: readonly { key: string; label: string }[], values: (string | null)[]): Bar[] {
  const n = new Map<string, number>();
  for (const v of values) if (v) n.set(v, (n.get(v) ?? 0) + 1);
  return keys.map((k) => ({ key: k.key, label: k.label, count: n.get(k.key) ?? 0 }));
}

const PIPELINE_KEYS = stageOrder.map((s) => ({ key: s, label: stageLabels[s] }));

export async function getSetterOverview(workspaceId: string, now: Date = new Date()): Promise<SetterOverview> {
  const cfg = getSetterConfig();
  const [drafts, due] = await Promise.all([
    pendingDrafts(workspaceId).then((d) => d.length).catch(() => 0),
    followupsDue(workspaceId, now).catch(() => 0),
  ]);

  if (osMockEnabled()) {
    const sales = mockThreads().filter((t) => t.contact?.kind === "SALES");
    const awaiting = sales.map((t) => {
      const msgs = mockMessages(t.conversationId);
      const lastIn = [...msgs].reverse().find((m) => !m.fromMe)?.createdTime ?? null;
      const lastOut = [...msgs].reverse().find((m) => m.fromMe)?.createdTime ?? null;
      return { theirLastAt: lastIn, ourLastAt: lastOut };
    });
    const closing = closingWindows(awaiting, now, cfg);
    return {
      draftsWaiting: drafts,
      windowsClosing: closing.count,
      nextClose: closing.nextClose,
      followupsDue: due,
      funnel: countBars(J_STAGES, sales.map((t) => t.contact!.setterStage)),
      pipeline: countBars(PIPELINE_KEYS, sales.map((t) => t.contact!.stage)),
    };
  }

  const [replyStates, contacts] = await Promise.all([
    // advance() sets nextActionKind "reply" exactly when they wrote last and the window is open.
    prisma.setterState.findMany({
      where: { workspaceId, nextActionKind: "reply", contact: { kind: "SALES", paused: false } },
      select: { record: true },
      take: 2000,
    }),
    prisma.contact.findMany({ where: { workspaceId, kind: "SALES" }, select: { setterStage: true, stage: true } }),
  ]);
  const closing = closingWindows(
    replyStates.map((s) => {
      const r = s.record as unknown as SetterRecord;
      return { theirLastAt: r?.their_last_at ?? null, ourLastAt: r?.our_last_at ?? null };
    }),
    now,
    cfg
  );
  return {
    draftsWaiting: drafts,
    windowsClosing: closing.count,
    nextClose: closing.nextClose,
    followupsDue: due,
    funnel: countBars(J_STAGES, contacts.map((c) => c.setterStage)),
    pipeline: countBars(PIPELINE_KEYS, contacts.map((c) => c.stage)),
  };
}
