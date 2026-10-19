// Which workflow an event starts, and the keyword uniqueness check at
// Publish (E12): one keyword lives in one place. Two workflows can't share a
// keyword on the same post (or both on "any post"); a specific post beats
// "any post" at match time; and a keyword never also lives in a live
// OpenReply campaign or a Zernio automation. Pure.

import { matchKeywords } from "@/lib/utils/keyword-matcher";
import type { KeywordClash } from "@/lib/os/workflows/api";
import { TriggerData, type GraphNode, type StepData, type WorkflowGraph } from "@/lib/os/workflows/graph";
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

export function graphKeywords(graph: WorkflowGraph): string[] {
  return [...new Set((triggerNode(graph)?.data.keywords ?? []).map(normKeyword).filter(Boolean))];
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
    const t = triggerNode(version.graph);
    if (!t || t.data.kind !== ev.surface) continue;
    let specific = false;
    if (ev.surface === "comment") {
      const posts = t.data.postIds;
      if (posts !== "any") {
        if (!posts.some((p) => (ev.postIds ?? []).includes(p))) continue;
        specific = true;
      }
    }
    const m = matchKeywords(ev.text, t.data.keywords, true);
    if (!m.matched) continue;
    hits.push({ wf, version, keyword: normKeyword(m.matchedKeyword ?? t.data.keywords[0]), specific });
  }
  hits.sort((a, b) => Number(b.specific) - Number(a.specific));
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

/** Every clash of this graph's keywords with other live places. Empty = fine. */
export function keywordClashes(graph: WorkflowGraph, others: OtherWorkflow[], campaigns: CampaignKeywords[], zernio: ZernioKeywords[]): KeywordClash[] {
  const t = triggerNode(graph);
  if (!t) return [];
  const mine = t.data.keywords;
  const out: KeywordClash[] = [];
  for (const o of others) {
    const ot = triggerNode(o.graph);
    if (!ot || ot.data.kind !== t.data.kind) continue;
    if (t.data.kind === "comment" && !postsCollide(t.data.postIds, ot.data.postIds)) continue;
    for (const k of overlap(mine, ot.data.keywords)) out.push({ keyword: k, with: "workflow", id: o.id, name: o.name });
  }
  for (const c of campaigns) {
    if (t.data.kind === "dm" && !c.dmTriggerEnabled) continue;
    if (t.data.kind === "comment" && !postsCollide(t.data.postIds, c.matchAnyPost ? "any" : c.postId ? [c.postId] : [])) {
      // A campaign on another post: still the same keyword in two places only when either is "any".
      continue;
    }
    for (const k of overlap(mine, c.keywords)) out.push({ keyword: k, with: "campaign", id: c.id, name: c.name });
  }
  for (const z of zernio) for (const k of overlap(mine, z.keywords)) out.push({ keyword: k, with: "zernio", id: z.slug, name: z.name });
  return out;
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
