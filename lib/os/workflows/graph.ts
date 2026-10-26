// The workflow graph: what the canvas edits and the engine runs. Stored as
// JSON on a workflow version. Shared contract between the engine
// (lib/os/workflows/*) and the builder (components/os/workflows/*); change it
// here only. Spec: docs/sp/dms/2026-10-19-workflows-spec.md.

import { z } from "zod";

export const STEP_TYPES = ["trigger", "message", "wait", "ask", "condition", "action", "randomizer", "setter", "goto", "end"] as const;
export type StepType = (typeof STEP_TYPES)[number];

/** Where an arrow leaves a node. Buttons use "button:<id>", quick replies "reply:<id>" (+ "other"), randomizer branches "branch:<id>". */
export const SETTER_EXITS = ["booked", "quiet", "not_a_fit", "stopped", "goal_met"] as const;
export type SetterExit = (typeof SETTER_EXITS)[number];

const text = z.string().max(2000);

const Bubble = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text }),
  /** A link always goes in its own bubble: a resource from the catalog, or a pasted URL. */
  z.object({ kind: z.literal("link"), resourceSlug: z.string().optional(), url: z.string().url().optional() }),
  z.object({
    kind: z.literal("buttons"),
    text,
    buttons: z.array(z.object({ id: z.string(), label: z.string().max(20) })).min(1).max(3),
  }),
  z.object({ kind: z.literal("image"), assetUrl: z.string() }),
  /**
   * Instagram quick replies: chips under the text, gone once they answer.
   * The label they pick is saved to `saveTo`. Always the message's last
   * bubble. Anything typed that isn't an option leaves by "other" (see
   * engine.ts › quickReply); unconnected, "other" follows the first option.
   */
  z.object({
    kind: z.literal("quick_replies"),
    text,
    options: z
      .array(
        z.object({
          id: z.string(),
          label: z.string().min(1).max(20),
          /** Picking it counts as qualified in the By reel stats (e.g. revenue $5K+). */
          qualifies: z.boolean().optional(),
        })
      )
      .min(1)
      .max(13),
    saveTo: z.string().optional(),
  }),
]);
export type Bubble = z.infer<typeof Bubble>;

export const TriggerData = z.object({
  kind: z.enum(["comment", "story_reply", "dm"]),
  keywords: z.array(z.string().min(1)).min(1),
  /** Comment triggers: these posts, or every post. Ignored for DMs and story replies. */
  postIds: z.union([z.array(z.string()), z.literal("any")]).default("any"),
  /** Public comment replies, one picked at random. Comment triggers only. */
  publicReplies: z.array(text).default([]),
  /** Re-entry after a finished run: never, after N days, or always. */
  reentry: z.object({ mode: z.enum(["never", "after_days", "always"]), days: z.number().int().positive().default(30) }).default({ mode: "after_days", days: 30 }),
});

export const MessageData = z.object({ bubbles: z.array(Bubble).min(1) });

export const WaitData = z.object({
  mode: z.enum(["delay", "until_reply", "until_field"]),
  minutes: z.number().int().positive().optional(),
  fieldKey: z.string().optional(),
  /** until_reply / until_field: give up after this long and leave by the "timeout" port. */
  timeoutMinutes: z.number().int().positive().optional(),
});

export const AskData = z.object({
  question: text,
  saveTo: z.string(),
  validate: z.enum(["email", "text", "number"]).default("text"),
  retry: text.optional(),
});

export const ConditionData = z.object({
  rule: z.object({ kind: z.enum(["follows", "tag", "field_set", "keyword_seen", "stage"]), value: z.string().optional() }),
});

export const ActionData = z.object({
  ops: z
    .array(z.object({ op: z.enum(["add_tag", "remove_tag", "set_field", "friday"]), key: z.string().optional(), value: z.string().optional() }))
    .min(1),
});

export const RandomizerData = z.object({
  branches: z.array(z.object({ id: z.string(), label: z.string(), weight: z.number().int().min(1) })).min(2),
});

export const SetterData = z.object({
  /** Empty = the account's default setter. */
  setterId: z.string().optional(),
  goal: z.enum(["book_call", "start_conversation"]),
  leadMagnet: z.object({
    mode: z.enum(["hold", "send_first", "none"]),
    resources: z.array(z.string()).default([]),
    /** One extra nudge inside the window may offer this second resource. */
    second: z.string().optional(),
  }),
  release: z
    .object({ booked: z.boolean(), quiet: z.boolean(), notReady: z.boolean(), askedTwice: z.boolean(), notFit: z.boolean() })
    .default({ booked: true, quiet: true, notReady: true, askedTwice: true, notFit: true }),
  /** The quiet release goes at a random time in this range of hours after their last message. */
  quietHours: z.tuple([z.number(), z.number()]).default([18, 22]),
  saveTo: z.array(z.string()).default([]),
});

export const GotoData = z.object({ workflowId: z.string() });
export const EndData = z.object({});

export const STEP_DATA = {
  trigger: TriggerData,
  message: MessageData,
  wait: WaitData,
  ask: AskData,
  condition: ConditionData,
  action: ActionData,
  randomizer: RandomizerData,
  setter: SetterData,
  goto: GotoData,
  end: EndData,
} as const;

export type StepData<T extends StepType = StepType> = z.infer<(typeof STEP_DATA)[T]>;

export const GraphNode = z.object({
  id: z.string(),
  type: z.enum(STEP_TYPES),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.unknown(),
});
export type GraphNode = z.infer<typeof GraphNode>;

export const GraphEdge = z.object({
  id: z.string(),
  from: z.string(),
  /** "next" | "timeout" | "yes" | "no" | "button:<id>" | "reply:<id>" | "other" | "branch:<id>" | "exit:<SetterExit>" */
  fromPort: z.string(),
  to: z.string(),
});
export type GraphEdge = z.infer<typeof GraphEdge>;

export const WorkflowGraph = z.object({ version: z.literal(1), nodes: z.array(GraphNode), edges: z.array(GraphEdge) });
export type WorkflowGraph = z.infer<typeof WorkflowGraph>;

/** The ports a node can have, so the builder draws handles and the engine follows edges. */
export function portsOf(node: { type: StepType; data: unknown }): string[] {
  switch (node.type) {
    case "end":
    case "goto":
      return [];
    case "wait":
      return (node.data as StepData<"wait">).mode === "delay" ? ["next"] : ["next", "timeout"];
    case "condition":
      return ["yes", "no"];
    case "randomizer":
      return (node.data as StepData<"randomizer">).branches.map((b) => `branch:${b.id}`);
    case "setter":
      return SETTER_EXITS.map((e) => `exit:${e}`);
    case "message": {
      const bubbles = (node.data as StepData<"message">).bubbles;
      const buttons = bubbles.flatMap((b) => (b.kind === "buttons" ? b.buttons : []));
      const replies = bubbles.flatMap((b) => (b.kind === "quick_replies" ? b.options : []));
      if (replies.length) return [...replies.map((o) => `reply:${o.id}`), "other"];
      return buttons.length ? buttons.map((b) => `button:${b.id}`) : ["next"];
    }
    default:
      return ["next"];
  }
}

export interface GraphProblem {
  nodeId?: string;
  message: string;
}

/** Problems that block Publish. An empty list = publishable. */
export function validateGraph(input: unknown): GraphProblem[] {
  const parsed = WorkflowGraph.safeParse(input);
  if (!parsed.success) return [{ message: parsed.error.issues[0]?.message ?? "Invalid workflow" }];
  const g = parsed.data;
  const problems: GraphProblem[] = [];
  const ids = new Set<string>();
  for (const n of g.nodes) {
    if (ids.has(n.id)) problems.push({ nodeId: n.id, message: "Duplicate step id" });
    ids.add(n.id);
    const r = STEP_DATA[n.type].safeParse(n.data);
    if (!r.success) problems.push({ nodeId: n.id, message: r.error.issues[0]?.message ?? "Step is incomplete" });
    else if (n.type === "message") {
      const bubbles = (r.data as StepData<"message">).bubbles;
      const qr = bubbles.findIndex((b) => b.kind === "quick_replies");
      if (qr >= 0 && bubbles.some((b) => b.kind === "buttons")) problems.push({ nodeId: n.id, message: "Buttons or quick replies, not both" });
      else if (qr >= 0 && qr !== bubbles.length - 1) problems.push({ nodeId: n.id, message: "Quick replies go in the last bubble" });
      if (bubbles.filter((b) => b.kind === "quick_replies").length > 1) problems.push({ nodeId: n.id, message: "One set of quick replies per message" });
    }
  }
  const triggers = g.nodes.filter((n) => n.type === "trigger");
  if (triggers.length !== 1) problems.push({ message: "A workflow needs exactly one trigger" });
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const used = new Set<string>();
  for (const e of g.edges) {
    const from = byId.get(e.from);
    if (!from || !byId.has(e.to)) {
      problems.push({ message: "An arrow points at a missing step" });
      continue;
    }
    if (byId.get(e.to)?.type === "trigger") problems.push({ nodeId: e.to, message: "Nothing can point at the trigger" });
    const key = `${e.from}:${e.fromPort}`;
    if (used.has(key)) problems.push({ nodeId: e.from, message: "Two arrows leave the same port" });
    used.add(key);
    if (from && STEP_DATA[from.type].safeParse(from.data).success && !portsOf(from).includes(e.fromPort))
      problems.push({ nodeId: e.from, message: `Unknown port ${e.fromPort}` });
  }
  return problems;
}
