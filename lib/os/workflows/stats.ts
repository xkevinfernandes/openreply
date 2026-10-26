// Per-step numbers for the canvas, from the run events. Pure.
import type { BranchFunnel, NodeStats, ReelFunnel, ReleaseRuleKey, StatsPeriod, WorkflowStats } from "@/lib/os/workflows/api";
import { STEP_DATA, type WorkflowGraph } from "@/lib/os/workflows/graph";

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
  opts: { period: StatsPeriod; now: Date; versionId?: string | null; showedRuns?: Set<string>; runPosts?: Map<string, string> }
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
    byReel: reelFunnels(graph, evs, trigger?.id ?? null, opts.runPosts ?? new Map()),
  };
}

/** Quick-reply message steps (the questions). */
function questionNodes(graph: WorkflowGraph): Set<string> {
  const out = new Set<string>();
  for (const n of graph.nodes) {
    if (n.type !== "message") continue;
    const r = STEP_DATA.message.safeParse(n.data);
    if (r.success && r.data.bubbles.some((b) => b.kind === "quick_replies")) out.add(n.id);
  }
  return out;
}

/** The last questions: question steps with no other question reachable after them. */
export function lastQuestions(graph: WorkflowGraph): Set<string> {
  const qs = questionNodes(graph);
  const out = new Set<string>();
  for (const q of qs) {
    const seen = new Set<string>([q]);
    const stack = graph.edges.filter((e) => e.from === q).map((e) => e.to);
    let later = false;
    while (stack.length && !later) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (qs.has(id)) later = true;
      else stack.push(...graph.edges.filter((e) => e.from === id).map((e) => e.to));
    }
    if (!later) out.add(q);
  }
  return out;
}

/**
 * By reel: per post id (comment runs), entered → email captured (an email
 * Ask step answered) → finished the last question → qualified (picked a quick
 * reply marked qualifies, e.g. revenue $5K+). From the events alone, no extra columns.
 */
export function reelFunnels(graph: WorkflowGraph, evs: StatEvent[], triggerId: string | null, runPosts: Map<string, string>): ReelFunnel[] {
  if (!runPosts.size) return [];
  const emailAsks = new Set(graph.nodes.filter((n) => n.type === "ask" && STEP_DATA.ask.safeParse(n.data).data?.validate === "email").map((n) => n.id));
  const last = lastQuestions(graph);
  // "node:reply:<id>" for every option marked qualifies.
  const qualifying = new Set(
    graph.nodes.flatMap((n) =>
      n.type === "message"
        ? (STEP_DATA.message.safeParse(n.data).data?.bubbles ?? []).flatMap((b) => (b.kind === "quick_replies" ? b.options.filter((o) => o.qualifies).map((o) => `${n.id}:reply:${o.id}`) : []))
        : []
    )
  );
  const saved = (e: StatEvent) => Boolean(e.data && typeof e.data === "object" && (e.data as { saved?: unknown }).saved);
  // Leaving a last question by an option or "other" (not a Quiet exit).
  const answered = (e: StatEvent) => e.kind === "leave" && last.has(e.nodeId) && Boolean(e.port) && (e.port!.startsWith("reply:") || e.port === "other");
  const per = new Map<string, { entered: Set<string>; email: Set<string>; finished: Set<string>; qualified: Set<string> }>();
  for (const e of evs) {
    const post = runPosts.get(e.runId);
    if (!post) continue;
    const row = per.get(post) ?? { entered: new Set(), email: new Set(), finished: new Set(), qualified: new Set() };
    per.set(post, row);
    if (e.kind === "enter" && e.nodeId === triggerId) row.entered.add(e.runId);
    if (e.kind === "replied" && emailAsks.has(e.nodeId) && saved(e)) row.email.add(e.runId);
    if (answered(e)) row.finished.add(e.runId);
    if (e.kind === "leave" && e.port && qualifying.has(`${e.nodeId}:${e.port}`)) row.qualified.add(e.runId);
  }
  return [...per]
    .map(([postId, r]) => ({ postId, permalink: null, entered: r.entered.size, email: r.email.size, finished: r.finished.size, qualified: r.qualified.size }))
    .filter((r) => r.entered > 0)
    .sort((a, b) => b.entered - a.entered || a.postId.localeCompare(b.postId));
}
