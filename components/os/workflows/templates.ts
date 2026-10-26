// The starting points in "New workflow" (WorkflowsList board). The
// graphs are the engine's (lib/os/workflows/templates.ts); the canvas lays
// them out left to right and fills in the first lead magnet.

import { portsOf, type StepData, type WorkflowGraph } from "@/lib/os/workflows/graph";
import type { TemplateId } from "@/lib/os/workflows/api";
import { HAND_LAID, TEMPLATES as ENGINE_TEMPLATES, templateGraph as engineTemplate, type TriggerKind } from "@/lib/os/workflows/templates";

export type { TriggerKind };

export type TemplateKey = TemplateId;
export const TEMPLATE_KEYS: TemplateKey[] = ENGINE_TEMPLATES.map((t) => t.id);
export const DEFAULT_TEMPLATE: TemplateKey = "hold_lead_magnet";

export interface TemplateInfo {
  key: TemplateKey;
  label: string;
  /** Hover text only. */
  description: string;
  isDefault?: boolean;
}

export const TEMPLATES: TemplateInfo[] = ENGINE_TEMPLATES.map((t) => ({ key: t.id, label: t.name, description: t.description, isDefault: t.id === DEFAULT_TEMPLATE || undefined }));

export function isTemplateKey(v: unknown): v is TemplateKey {
  return typeof v === "string" && (TEMPLATE_KEYS as string[]).includes(v);
}

const COL = 320;
const ROW = 280;

/**
 * Left-to-right layout for the free canvas: each step one column right of
 * the step that first reaches it (ports in order), stacked within a column.
 * Steps nothing reaches go in a last column.
 */
export function layoutGraph(graph: WorkflowGraph): WorkflowGraph {
  const trigger = graph.nodes.find((n) => n.type === "trigger");
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const depth = new Map<string, number>();
  const order: string[] = [];
  const queue: string[] = trigger ? [trigger.id] : [];
  if (trigger) depth.set(trigger.id, 0);
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    const node = byId.get(id)!;
    let ports: string[] = [];
    try {
      ports = portsOf(node);
    } catch {
      ports = [];
    }
    const out = graph.edges.filter((e) => e.from === id).sort((a, b) => ports.indexOf(a.fromPort) - ports.indexOf(b.fromPort));
    for (const e of out) {
      if (depth.has(e.to) || !byId.has(e.to)) continue;
      depth.set(e.to, depth.get(id)! + 1);
      queue.push(e.to);
    }
  }
  const last = Math.max(0, ...depth.values()) + 1;
  for (const n of graph.nodes) if (!depth.has(n.id)) {
    depth.set(n.id, last);
    order.push(n.id);
  }
  const rows = new Map<number, number>();
  const pos = new Map<string, { x: number; y: number }>();
  for (const id of order) {
    const d = depth.get(id)!;
    const r = rows.get(d) ?? 0;
    rows.set(d, r + 1);
    pos.set(id, { x: d * COL, y: 80 + r * ROW });
  }
  return { ...graph, nodes: graph.nodes.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position })) };
}

/** The first lead magnet goes on the Setter step and on links without one. */
export function fillResource(graph: WorkflowGraph, resource?: string): WorkflowGraph {
  if (!resource) return graph;
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      if (n.type === "setter") {
        const d = n.data as StepData<"setter">;
        if (d.leadMagnet.mode !== "none" && !d.leadMagnet.resources.length) return { ...n, data: { ...d, leadMagnet: { ...d.leadMagnet, resources: [resource] } } };
      }
      if (n.type === "message") {
        const d = n.data as StepData<"message">;
        if (d.bubbles.some((b) => b.kind === "link" && !b.resourceSlug))
          return { ...n, data: { ...d, bubbles: d.bubbles.map((b) => (b.kind === "link" && !b.resourceSlug ? { kind: "link" as const, resourceSlug: resource } : b)) } };
      }
      return n;
    }),
  };
}

/** Laid out left to right, unless the template places its own steps (HAND_LAID). */
export function layoutFor(key: TemplateKey, graph: WorkflowGraph): WorkflowGraph {
  return HAND_LAID.includes(key) ? graph : layoutGraph(graph);
}

/** A template as the canvas opens it, with the keyword(s) and trigger kind "New workflow" asked for. */
export function templateGraph(key: TemplateKey, resource?: string, trigger: { keywords?: string[]; kind?: TriggerKind } = {}): WorkflowGraph {
  return layoutFor(key, fillResource(engineTemplate(key, { resource, keywords: trigger.keywords, kind: trigger.kind }), resource));
}
