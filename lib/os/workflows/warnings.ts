// Builder warnings: they don't block Publish, they tell Kevin what Instagram
// will do (S7). Pure.

import type { GraphWarning } from "@/lib/os/workflows/api";
import { STEP_DATA, type WorkflowGraph } from "@/lib/os/workflows/graph";

const DAY_MIN = 24 * 60;

export function graphWarnings(graph: WorkflowGraph): GraphWarning[] {
  const out: GraphWarning[] = [];
  const reached = new Set(graph.edges.map((e) => e.to));
  for (const n of graph.nodes) {
    if (n.type !== "trigger" && !reached.has(n.id)) out.push({ nodeId: n.id, message: "Nothing leads here" });
    if (n.type === "wait") {
      const r = STEP_DATA.wait.safeParse(n.data);
      if (!r.success) continue;
      const mins = r.data.mode === "delay" ? (r.data.minutes ?? 0) : (r.data.timeoutMinutes ?? 0);
      if (mins >= 7 * DAY_MIN) out.push({ nodeId: n.id, message: "Past 7 days: Instagram won't let anything send after this" });
      else if (mins >= DAY_MIN) out.push({ nodeId: n.id, message: "Past Instagram's 24h: will need your approval (HUMAN_AGENT) or won't send after 7 days" });
    }
    if (n.type === "setter") {
      const r = STEP_DATA.setter.safeParse(n.data);
      if (r.success && r.data.leadMagnet.mode !== "none" && !r.data.leadMagnet.resources.length) out.push({ nodeId: n.id, message: "Pick the lead magnet J holds" });
    }
    if (n.type === "message") {
      const r = STEP_DATA.message.safeParse(n.data);
      if (r.success && r.data.bubbles.some((b) => b.kind === "link" && !b.resourceSlug && !b.url)) out.push({ nodeId: n.id, message: "A link bubble has no link" });
    }
  }
  return out;
}
