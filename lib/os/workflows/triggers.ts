// Which workflow an event starts, and the keyword uniqueness check at
// Publish (E12): one keyword lives in one place. A workflow can have several
// triggers (graph.ts triggerList: e.g. PLAN on any post AND PLAN by DM); every
// one of them is matched and checked. Two workflows can't share a
// keyword on the same post (or both on "any post"); a specific post beats
// "any post" at match time; and a keyword never also lives in a live
// OpenReply campaign or a Zernio automation. Pure.

import { matchKeywords } from "@/lib/utils/keyword-matcher";
import type { KeywordClash } from "@/lib/os/workflows/api";
import { TriggerData, triggerList, withTriggerList, type GraphNode, type StepData, type TriggerSpec, type WorkflowGraph } from "@/lib/os/workflows/graph";
import type { VersionDef, WorkflowDef } from "@/lib/os/workflows/types";

export type Surface = "comment" | "story_reply" | "dm";
export type TriggerStep = StepData<"trigger">;

export function triggerNode(graph: WorkflowGraph): (GraphNode & { data: TriggerStep }) | null {
  const n = graph.nodes.find((x) => x.type === "trigger");
  if (!n) return null;
  const r = TriggerData.safeParse(n.data);
  return r.success ? { ...n, data: r.data } : null;
}

export const normKeyword = (k: string) => k.trim().toLowerCase();

/** Every trigger of a graph (empty without a trigger step). */
export function graphTriggers(graph: WorkflowGraph): TriggerSpec[] {
  const t = triggerNode(graph);
  return t ? triggerList(t.data) : [];
}

/**
 * The graph with this trigger added to its trigger step (a script adding
 * "DM keyword PLAN" to a comment workflow's draft, then saveDraft). Same
 * graph back when there's no trigger step or the trigger is already there.
 */
export function addTrigger(graph: WorkflowGraph, spec: Omit<TriggerSpec, "postIds"> & { postIds?: TriggerSpec["postIds"] }): WorkflowGraph {
  const t = triggerNode(graph);
  if (!t) return graph;
  const list = triggerList(t.data);
  const same = (a: TriggerSpec) =>
    a.kind === spec.kind &&
    JSON.stringify([...a.keywords].map(normKeyword).sort()) === JSON.stringify([...spec.keywords].map(normKeyword).sort()) &&
    JSON.stringify(a.postIds ?? "any") === JSON.stringify(spec.postIds ?? "any");
  if (list.some(same)) return graph;
  const raw = graph.nodes.find((n) => n.id === t.id)!.data as StepData<"trigger">;
  const data = withTriggerList(raw, [...list, { id: spec.id ?? `t${list.length + 1}`, kind: spec.kind, keywords: spec.keywords, postIds: spec.postIds ?? "any" }]);
  return { ...graph, nodes: graph.nodes.map((n) => (n.id === t.id ? { ...n, data } : n)) };
}

/** Every keyword of every trigger, lower case, once each. */
export function graphKeywords(graph: WorkflowGraph): string[] {
  return [...new Set(graphTriggers(graph).flatMap((t) => t.keywords).map(normKeyword).filter(Boolean))];
}

/** A comment trigger of this graph aimed at one of these posts (not "any post"). */
export function aimsAtPosts(graph: WorkflowGraph, postIds: string[]): boolean {
  return graphTriggers(graph).some((t) => t.kind === "comment" && t.postIds !== "any" && t.postIds.some((p) => postIds.includes(p)));
}

export interface TriggerEvent {
  surface: Surface;
  text: string;
  /** Comment: the media id (and the organic post behind an ad). */
  postIds?: string[];
}

export interface TriggerMatch {
  wf: WorkflowDef;
  version: VersionDef;
  keyword: string;
  /** Matched a specific post (beats "any post"). */
  specific: boolean;
}

/** The workflow this event starts, if any. A specific post beats "any post". */
export function matchTrigger(live: { wf: WorkflowDef; version: VersionDef }[], ev: TriggerEvent): TriggerMatch | null {
  const hits: TriggerMatch[] = [];
  for (const { wf, version } of live) {
    for (const t of graphTriggers(version.graph)) {
      if (t.kind !== ev.surface) continue;
      let specific = false;
      if (ev.surface === "comment") {
        const posts = t.postIds ?? "any";
        if (posts !== "any") {
          if (!posts.some((p) => (ev.postIds ?? []).includes(p))) continue;
          specific = true;
        }
      }
      const m = matchKeywords(ev.text, t.keywords, true);
      if (!m.matched) continue;
      hits.push({ wf, version, keyword: normKeyword(m.matchedKeyword ?? t.keywords[0]), specific });
    }
  }
  // A post-specific trigger first, then the longest keyword: "founder 3"
  // belongs to FOUNDER 3, not to FOUNDER.
  hits.sort((a, b) => Number(b.specific) - Number(a.specific) || b.keyword.length - a.keyword.length);
  return hits[0] ?? null;
}

// ---------------------------------------------------------------- uniqueness
export interface CampaignKeywords {
  id: string;
  name: string;
  keywords: string[];
  postId: string | null;
  matchAnyPost: boolean;
  dmTriggerEnabled: boolean;
}

export interface ZernioKeywords {
  slug: string;
  name: string;
  keywords: string[];
}

export interface OtherWorkflow {
  id: string;
  name: string;
  graph: WorkflowGraph;
}

const overlap = (a: string[], b: string[]) => {
  const B = new Set(b.map(normKeyword));
  return [...new Set(a.map(normKeyword))].filter((k) => k && B.has(k));
};

/** Posts collide when both are "any", or they share a specific post. "Any" vs a specific post is fine (the specific one wins). */
function postsCollide(a: string[] | "any", b: string[] | "any"): boolean {
  if (a === "any" && b === "any") return true;
  if (a === "any" || b === "any") return false;
  return a.some((p) => b.includes(p));
}

/** Every clash of this graph's keywords with other live places. Empty = fine.
 *  Each trigger is checked against each trigger of the others: same keyword +
 *  same channel + overlapping posts = a clash. A comment and a DM never clash. */
export function keywordClashes(graph: WorkflowGraph, others: OtherWorkflow[], campaigns: CampaignKeywords[], zernio: ZernioKeywords[]): KeywordClash[] {
  const mineAll = graphTriggers(graph);
  if (!mineAll.length) return [];
  const out: KeywordClash[] = [];
  const seen = new Set<string>();
  const push = (c: KeywordClash) => {
    const key = `${c.with}:${c.id}:${c.keyword}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };
  for (const t of mineAll) {
    const myPosts = t.postIds ?? "any";
    for (const o of others) {
      for (const ot of graphTriggers(o.graph)) {
        if (ot.kind !== t.kind) continue;
        if (t.kind === "comment" && !postsCollide(myPosts, ot.postIds ?? "any")) continue;
        for (const k of overlap(t.keywords, ot.keywords)) push({ keyword: k, with: "workflow", id: o.id, name: o.name });
      }
    }
    for (const c of campaigns) {
      if (t.kind === "dm" && !c.dmTriggerEnabled) continue;
      if (t.kind === "comment") {
        // OpenReply doesn't know "the specific post wins": any overlap is a clash ("any" overlaps every post).
        const theirs: string[] | "any" = c.matchAnyPost ? "any" : c.postId ? [c.postId] : [];
        const overlapPosts = myPosts === "any" || theirs === "any" ? myPosts === "any" || theirs.length > 0 || theirs === "any" : myPosts.some((p) => theirs.includes(p));
        if (!overlapPosts) continue;
      }
      for (const k of overlap(t.keywords, c.keywords)) push({ keyword: k, with: "campaign", id: c.id, name: c.name });
    }
  }
  const all = mineAll.flatMap((t) => t.keywords);
  for (const z of zernio) for (const k of overlap(all, z.keywords)) push({ keyword: k, with: "zernio", id: z.slug, name: z.name });
  return out;
}

/** "FOUNDER already lives in the workflow "X". One keyword, one place." */
export function clashMessage(c: KeywordClash): string {
  const where = c.with === "workflow" ? `the workflow "${c.name}"` : c.with === "campaign" ? `the campaign "${c.name}"` : `Zernio (${c.name})`;
  return `${c.keyword.toUpperCase()} already lives in ${where}. One keyword, one place.`;
}

/** Zernio keywords from the catalog: active resources not run by OpenReply. */
export function zernioKeywordsOf(rows: { slug: string; name: string; keyword: string | null; status: string; data: unknown }[]): ZernioKeywords[] {
  const out: ZernioKeywords[] = [];
  for (const r of rows) {
    if (r.status !== "ACTIVE") continue;
    const d = (r.data && typeof r.data === "object" ? r.data : {}) as { engine?: string; zernio?: { keyword?: string }; triggers?: { keyword?: string | null }[] };
    if (d.engine === "openreply" || d.engine === "workflow") continue;
    const ks = [r.keyword, d.zernio?.keyword, ...(d.triggers ?? []).map((t) => t.keyword)].filter((k): k is string => Boolean(k && k.trim()));
    if (ks.length) out.push({ slug: r.slug, name: r.name, keywords: [...new Set(ks.map(normKeyword))] });
  }
  return out;
}
