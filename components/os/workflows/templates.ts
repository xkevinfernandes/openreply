// The four starting points in "New workflow" (WorkflowsList board).
// TODO(wfengine): the plan puts the canonical template graphs in
// lib/os/workflows/templates.ts (C1). Switch TEMPLATE_GRAPHS to that export
// once it lands; the picker below only needs {key, label, graph}.

import { defaultData, edgeId } from "@/components/os/workflows/graph-edit";
import type { GraphEdge, GraphNode, StepData, WorkflowGraph } from "@/lib/os/workflows/graph";

export const TEMPLATE_KEYS = ["hold", "simple", "conversation", "blank"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export interface TemplateInfo {
  key: TemplateKey;
  label: string;
  /** The workflow's starting name. */
  name: string;
  isDefault?: boolean;
}

export const TEMPLATES: TemplateInfo[] = [
  { key: "hold", label: "Hold the lead magnet", name: "Hold the lead magnet", isDefault: true },
  { key: "simple", label: "Simple: send the link", name: "Send the link" },
  { key: "conversation", label: "Start a conversation", name: "Start a conversation" },
  { key: "blank", label: "Blank", name: "Untitled workflow" },
];

export function isTemplateKey(v: unknown): v is TemplateKey {
  return typeof v === "string" && (TEMPLATE_KEYS as readonly string[]).includes(v);
}

const X = 280;

function n(id: string, type: GraphNode["type"], col: number, row: number, data?: unknown): GraphNode {
  return { id, type, position: { x: col * X, y: 80 + row * 220 }, data: data ?? defaultData(type) };
}

function e(from: string, port: string, to: string): GraphEdge {
  return { id: edgeId(from, port), from, fromPort: port, to };
}

const opener: StepData<"message"> = {
  bubbles: [
    { kind: "text", text: "hey {first_name}! caught your comment, want me to drop it below?" },
    { kind: "text", text: "got a couple of versions so I send the right one, are you doing DMs yourself or with a team?" },
  ],
};

const trigger = (): StepData<"trigger"> => ({
  kind: "comment",
  keywords: [],
  postIds: "any",
  publicReplies: ["sent it to your DMs", "just sent it over", "check your DMs"],
  reentry: { mode: "after_days", days: 30 },
});

function hold(resource?: string): WorkflowGraph {
  const setter: StepData<"setter"> = {
    goal: "book_call",
    leadMagnet: { mode: "hold", resources: resource ? [resource] : [] },
    release: { booked: true, quiet: true, notReady: true, askedTwice: true, notFit: true },
    quietHours: [18, 22],
    saveTo: [],
  };
  return {
    version: 1,
    nodes: [
      n("trigger", "trigger", 0, 0, trigger()),
      n("s1", "message", 1, 0, opener),
      n("s2", "setter", 2, 0, setter),
      n("s3", "action", 3, 1, { ops: [{ op: "add_tag", key: "ghosted" }, { op: "friday" }] } satisfies StepData<"action">),
      n("s4", "end", 4, 1),
    ],
    edges: [e("trigger", "next", "s1"), e("s1", "next", "s2"), e("s2", "exit:quiet", "s3"), e("s3", "next", "s4")],
  };
}

function simple(resource?: string): WorkflowGraph {
  return {
    version: 1,
    nodes: [
      n("trigger", "trigger", 0, 0, trigger()),
      n("s1", "message", 1, 0, {
        bubbles: [{ kind: "text", text: "hey {first_name}! here you go" }, resource ? { kind: "link", resourceSlug: resource } : { kind: "link" }],
      } satisfies StepData<"message">),
      n("s2", "action", 2, 0, { ops: [{ op: "add_tag", key: "lead-magnet-sent" }] } satisfies StepData<"action">),
      n("s3", "end", 3, 0),
    ],
    edges: [e("trigger", "next", "s1"), e("s1", "next", "s2"), e("s2", "next", "s3")],
  };
}

function conversation(): WorkflowGraph {
  const setter: StepData<"setter"> = {
    goal: "start_conversation",
    leadMagnet: { mode: "none", resources: [] },
    release: { booked: true, quiet: true, notReady: true, askedTwice: true, notFit: true },
    quietHours: [18, 22],
    saveTo: [],
  };
  return {
    version: 1,
    nodes: [
      n("trigger", "trigger", 0, 0, { ...trigger(), kind: "dm", publicReplies: [] }),
      n("s1", "message", 1, 0, { bubbles: [{ kind: "text", text: "hey {first_name}! what made you reach out?" }] } satisfies StepData<"message">),
      n("s2", "setter", 2, 0, setter),
      n("s3", "end", 3, 0),
    ],
    edges: [e("trigger", "next", "s1"), e("s1", "next", "s2"), e("s2", "exit:goal_met", "s3")],
  };
}

/** A template's graph. The first lead magnet (if any) is filled in. */
export function templateGraph(key: TemplateKey, resource?: string): WorkflowGraph {
  switch (key) {
    case "hold":
      return hold(resource);
    case "simple":
      return simple(resource);
    case "conversation":
      return conversation();
    case "blank":
      return { version: 1, nodes: [n("trigger", "trigger", 0, 0)], edges: [] };
  }
}
