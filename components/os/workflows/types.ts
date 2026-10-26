// What the Workflows screens read. Shaped like the engine API the plan
// describes (lib/os/workflows/api.ts, stream wfengine); see data.ts.

import type { BranchCounts } from "@/components/os/workflows/forms";
import type { StepData, WorkflowGraph } from "@/lib/os/workflows/graph";

export type WorkflowMode = "draft" | "auto";
export type TriggerKind = StepData<"trigger">["kind"];

/** Triggered → Replied → Lead magnet → Booked → Showed. */
export interface FunnelStrip {
  triggered: number;
  replied: number;
  leadMagnet: number;
  booked: number;
  showed: number;
}

export interface WorkflowRow {
  id: string;
  name: string;
  trigger: { kind: TriggerKind; keywords: string[] };
  mode: WorkflowMode;
  on: boolean;
  /** A Randomizer is running. */
  ab: boolean;
  funnel: FunnelStrip;
  /** Last published version, null = never published. */
  version: number | null;
  /** The draft differs from the published version. */
  unpublished: boolean;
  /** People in it right now (active, waiting or paused). */
  live: number;
}

export interface NodeStat {
  reached: number;
  /** Share of the step before it, 0..1; null for the trigger. */
  share: number | null;
}

export interface WorkflowStats {
  strip: FunnelStrip;
  since: string | null;
  nodes: Record<string, NodeStat>;
  /** People who left by each port: {nodeId: {"exit:booked": 6}}. */
  ports: Record<string, Record<string, number>>;
  /** Setter steps: releases per rule. */
  releases: Record<string, Partial<Record<"booked" | "quiet" | "notReady" | "askedTwice" | "notFit", number>>>;
  /** Randomizer steps: the funnel per branch. */
  branches: Record<string, Record<string, BranchCounts>>;
  /** Comment runs per post: entered → email → finished the questions → qualified. */
  byReel: ReelRow[];
}

export interface ReelRow {
  postId: string;
  permalink: string | null;
  entered: number;
  email: number;
  finished: number;
  qualified: number;
}

export interface WorkflowDetail {
  id: string;
  name: string;
  mode: WorkflowMode;
  on: boolean;
  /** The draft being edited (the published graph until the first edit). */
  graph: WorkflowGraph;
  version: number | null;
  /** The draft differs from the published version. */
  unpublished: boolean;
  updatedAt: string;
  /** People in it right now (active, waiting or paused). */
  live: number;
}

export interface ContactRun {
  workflowId: string;
  workflowName: string;
  stepId: string;
  /** "Setter", "Message", … */
  stepLabel: string;
  status: "active" | "paused";
}

export type Period = "7d" | "30d" | "all";
