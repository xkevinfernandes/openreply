// Per-step numbers for the canvas, from the run events. Pure.
import type { BranchFunnel, NodeStats, ReleaseRuleKey, StatsPeriod, WorkflowStats } from "@/lib/os/workflows/api";
import type { WorkflowGraph } from "@/lib/os/workflows/graph";

export interface StatEvent {
  runId: string;
  nodeId: string;
  kind: string;
  port: string | null;
  at: Date;
  versionId: string;
  /** released: {slug, rule}. */
  data?: unknown;
}

const RULE_KEY: Record<string, ReleaseRuleKey> = { R1: "booked", R2: "quiet", R3: "notReady", R4: "askedTwice", R5: "notFit" };
const ruleOf = (e: StatEvent): ReleaseRuleKey | null => {
  const r = (e.data && typeof e.data === "object" ? (e.data as { rule?: unknown }).rule : null) as string | null;
  return r ? (RULE_KEY[r] ?? null) : null;
};

export function periodStart(period: StatsPeriod, now: Date): Date | null {
  if (period === "all") return null;
  return new Date(now.getTime() - (period === "7d" ? 7 : 30) * 86_400_000);
}

/**
 * Reached = distinct people who entered the step. % of the step before it =
 * reached / reached of the first step with an arrow into it. Setter steps add
 * replied / released / booked / showed; arrows carry the people who left by
 * that port. `showedRuns` are runs whose call they showed up to.
 */
export function computeStats(
  graph: WorkflowGraph,
  events: StatEvent[],
  opts: { period: StatsPeriod; now: Date; versionId?: string | null; showedRuns?: Set<string> }
): WorkflowStats {
  const from = periodStart(opts.period, opts.now);
  const evs = events.filter((e) => (!from || e.at >= from) && (!opts.versionId || e.versionId === opts.versionId));
  const runsWith = (pred: (e: StatEvent) => boolean) => new Set(evs.filter(pred).map((e) => e.runId));
  const reached = new Map<string, Set<string>>();
  for (const e of evs) if (e.kind === "enter") (reached.get(e.nodeId) ?? reached.set(e.nodeId, new Set()).get(e.nodeId)!).add(e.runId);
  const count = (id: string) => reached.get(id)?.size ?? 0;
  const showed = opts.showedRuns ?? new Set<string>();
  const nodes: Record<string, NodeStats> = {};
  for (const n of graph.nodes) {
    const prev = graph.edges.find((e) => e.to === n.id)?.from ?? null;
    const prevCount = prev ? count(prev) : 0;
    const stat: NodeStats = { nodeId: n.id, type: n.type, reached: count(n.id), pctOfPrev: prev && prevCount ? Math.min(1, count(n.id) / prevCount) : null };
    if (n.type === "setter") {
      const here = reached.get(n.id) ?? new Set<string>();
      const booked = runsWith((e) => e.nodeId === n.id && e.kind === "booked");
      stat.setter = {
        reached: here.size,
        replied: runsWith((e) => e.nodeId === n.id && e.kind === "replied").size,
        released: runsWith((e) => e.nodeId === n.id && e.kind === "released").size,
        releasedBy: (["booked", "quiet", "notReady", "askedTwice", "notFit"] as ReleaseRuleKey[]).reduce(
          (o, k) => ({ ...o, [k]: runsWith((e) => e.nodeId === n.id && e.kind === "released" && ruleOf(e) === k).size }),
          {} as Record<ReleaseRuleKey, number>
        ),
        booked: booked.size,
        showed: [...booked].filter((r) => showed.has(r)).length,
      };
    }
    if (n.type === "randomizer") {
      const replied = runsWith((e) => e.kind === "replied");
      const lead = runsWith((e) => e.kind === "released");
      const booked = runsWith((e) => e.kind === "booked");
      const branches: Record<string, BranchFunnel> = {};
      const ids = ((n.data as { branches?: { id: string }[] })?.branches ?? []).map((b) => b.id);
      for (const id of ids) {
        const runs = runsWith((e) => e.nodeId === n.id && e.kind === "leave" && e.port === `branch:${id}`);
        const inB = (set: Set<string>) => [...runs].filter((r) => set.has(r)).length;
        branches[id] = { reached: runs.size, replied: inB(replied), leadMagnet: inB(lead), booked: inB(booked), showed: [...runs].filter((r) => booked.has(r) && showed.has(r)).length };
      }
      stat.branches = branches;
    }
    nodes[n.id] = stat;
  }
  const ports: Record<string, number> = {};
  const seen = new Set<string>();
  for (const e of evs) {
    if (e.kind !== "leave" || !e.port) continue;
    const k = `${e.nodeId}:${e.port}`;
    if (seen.has(`${k}:${e.runId}`)) continue;
    seen.add(`${k}:${e.runId}`);
    ports[k] = (ports[k] ?? 0) + 1;
  }
  const trigger = graph.nodes.find((n) => n.type === "trigger");
  const bookedAll = runsWith((e) => e.kind === "booked");
  return {
    period: opts.period,
    versionId: opts.versionId ?? null,
    header: {
      triggered: trigger ? count(trigger.id) : 0,
      replied: runsWith((e) => e.kind === "replied").size,
      leadMagnet: runsWith((e) => e.kind === "released").size,
      booked: bookedAll.size,
      showed: [...bookedAll].filter((r) => showed.has(r)).length,
    },
    nodes,
    ports,
  };
}
