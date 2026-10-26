// Resources rows, pure (no database), so the client screen can use the
// helpers. The loader is lib/os/resources-board.ts.

import type { ResourceKind, ResourceView } from "@/lib/os/knowledge";
import { shortLink } from "@/lib/os/setter/knowledge/resources-view";
import { DOC_FILES, DOC_KEYS, type DocKey } from "@/lib/os/setter/knowledge/docs";

export type UsedByKind = "agent" | "campaign" | "workflow" | "broadcast" | "sequences";

export interface UsedBy {
  kind: UsedByKind;
  id: string;
  name: string;
  href: string;
  /** Broadcasts only: not sent yet (refuses delete). */
  unsent?: boolean;
}

export interface ResourceRow extends ResourceView {
  usedByAll: UsedBy[];
  /** Agent ids that may offer it (the sheet's ticks). */
  agentIds: string[];
}

export interface KnowledgeDocRow {
  key: DocKey;
  name: string;
  sub: string;
  /** Agents with something written in it. */
  agents: { id: string; name: string }[];
  href: string;
}

export interface ResourcesBoard {
  rows: ResourceRow[];
  /** Entry paths (kind "setter"): folded at the bottom, not counted. */
  entries: ResourceRow[];
  docs: KnowledgeDocRow[];
  agents: { id: string; name: string }[];
  counts: { all: number; magnets: number; videos: number; docs: number };
  /** OS_MOCK sample (nothing in the database yet). */
  sample: boolean;
}

export type ResourceFilter = "all" | "magnets" | "videos" | "docs";

export const KIND_LABEL: Record<ResourceKind, string> = { resource: "Lead magnet", episode: "Video", setter: "Entry path" };

export function kindLabel(kind: ResourceKind): string {
  return KIND_LABEL[kind];
}

export function matchesFilter(kind: ResourceKind, f: ResourceFilter): boolean {
  if (f === "all") return kind !== "setter";
  if (f === "magnets") return kind === "resource";
  if (f === "videos") return kind === "episode";
  return false;
}

export function pillCounts(rows: { kind: ResourceKind }[], docs: number): ResourcesBoard["counts"] {
  // All lists the knowledge docs too, so it counts them.
  return {
    all: rows.filter((r) => r.kind !== "setter").length + docs,
    magnets: rows.filter((r) => r.kind === "resource").length,
    videos: rows.filter((r) => r.kind === "episode").length,
    docs,
  };
}

/** "kevinfernandes.me/setter-starter", or null for "No link yet". */
export function linkLabel(link: string | null): string | null {
  return (link && shortLink(link)) || null;
}

export interface UsageInputs {
  agents: { id: string; name: string }[];
  /** CampaignResource rows with the campaign's name. */
  campaigns: { automationId: string; resourceId: string; name: string }[];
  /** Workflows with the slugs their current version hands out. */
  workflows: { id: string; name: string; slugs: string[] }[];
}

/** Everything that uses one resource, agents first. Broadcasts come from the row itself (ResourceView.broadcasts). */
export function usedByOf(r: { id: string; slug: string; broadcasts?: ResourceView["broadcasts"] }, agentIds: string[], inputs: UsageInputs): UsedBy[] {
  const out: UsedBy[] = [];
  for (const id of agentIds) {
    const a = inputs.agents.find((x) => x.id === id);
    if (a) out.push({ kind: "agent", id: a.id, name: a.name, href: `/os/knowledge/${a.id}` });
  }
  for (const c of inputs.campaigns.filter((x) => x.resourceId === r.id)) out.push({ kind: "campaign", id: c.automationId, name: c.name, href: `/os/automations/${c.automationId}` });
  for (const w of inputs.workflows.filter((x) => x.slugs.includes(r.slug))) out.push({ kind: "workflow", id: w.id, name: w.name, href: `/os/automations/workflows/${w.id}` });
  for (const b of r.broadcasts ?? []) out.push({ kind: "broadcast", id: b.key, name: b.name, href: `/os/automations/broadcasts/${b.key}`, unsent: b.unsent });
  const first = agentIds.map((id) => inputs.agents.find((a) => a.id === id)).find(Boolean);
  if (first) out.push({ kind: "sequences", id: "sequences", name: `Sequences via ${first.name}`, href: `/os/knowledge/${first.id}` });
  return out;
}

/** One chip per name: two broadcasts called the same (a duplicate) show once, "×2". */
export function usedChips(used: UsedBy[]): (UsedBy & { count: number })[] {
  const out: (UsedBy & { count: number })[] = [];
  for (const u of used) {
    const hit = out.find((o) => o.kind === u.kind && o.name === u.name);
    if (hit) hit.count += 1;
    else out.push({ ...u, count: 1 });
  }
  return out;
}

/** Why a resource can't be deleted yet: the campaigns, workflows and unsent broadcasts using it. */
export function deleteBlockers(used: UsedBy[]): UsedBy[] {
  return used.filter((u) => u.kind === "campaign" || u.kind === "workflow" || (u.kind === "broadcast" && u.unsent));
}

export const USED_BY_LABEL: Record<UsedByKind, string> = { agent: "Agent", campaign: "Campaign", workflow: "Workflow", broadcast: "Broadcast", sequences: "Sequences" };

/** The agents to name in the delete confirm (their links go with it). */
export function offeringAgents(used: UsedBy[]): UsedBy[] {
  return used.filter((u) => u.kind === "agent");
}

function docRows(agents: { id: string; name: string }[], written: { setterId: string; key: string }[]): KnowledgeDocRow[] {
  // The shared method and Examples aren't knowledge you hand out; the three the canvas lists are.
  const keys = DOC_KEYS.filter((k) => k === "offers" || k === "objections" || k === "business");
  return keys.map((key) => {
    const who = agents.filter((a) => written.some((w) => w.setterId === a.id && w.key === key));
    return {
      key,
      name: DOC_FILES[key].title,
      sub: DOC_FILES[key].usedWhen,
      agents: who,
      href: who[0] || agents[0] ? `/os/knowledge/${(who[0] ?? agents[0]).id}?doc=${key}` : "/os/knowledge",
    };
  });
}

export function buildBoard(resources: ResourceView[], agentLinks: Map<string, string[]>, inputs: UsageInputs, written: { setterId: string; key: string }[], sample = false): ResourcesBoard {
  const all = resources.map((r): ResourceRow => {
    const agentIds = agentLinks.get(r.id) ?? r.usedBy.map((s) => s.id);
    return { ...r, agentIds, usedByAll: usedByOf(r, agentIds, inputs) };
  });
  const docs = docRows(inputs.agents, written);
  const rows = all.filter((r) => r.kind !== "setter");
  return { rows, entries: all.filter((r) => r.kind === "setter"), docs, agents: inputs.agents, counts: pillCounts(all, docs.length), sample };
}

