"use client";

// One step on the canvas (WorkflowA node faces): header with icon, label and
// count · %, a compact body, and a handle per port from portsOf.

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import { fieldLabel, resourceName, setterOf, syncTitle, type BuilderContext } from "@/components/os/workflows/context";
import { CONDITION_RULES, formatMinutes, portLabel, safePorts, savesTo, setterSummary, STEP_LABEL, TRIGGER_KIND_LABEL, waitWindowWarning } from "@/components/os/workflows/forms";
import { WfIcon } from "@/components/os/workflows/icons";
import { nodeStatText } from "@/components/os/workflows/view";
import type { Bubble, GraphNode, StepData } from "@/lib/os/workflows/graph";

export interface StepNodeData extends Record<string, unknown> {
  node: GraphNode;
  problems: string[];
  ctx: BuilderContext;
}

export type StepNodeType = Node<StepNodeData, "step">;

const WIDTH: Partial<Record<GraphNode["type"], number>> = { randomizer: 168, setter: 236, end: 120, goto: 180 };

function Bubbles({ bubbles, ctx }: { bubbles: Bubble[]; ctx: BuilderContext }) {
  const shown = bubbles.slice(0, 3);
  return (
    <>
      {shown.map((b, i) => {
        if (b.kind === "text") return <span key={i} className="wf-b">{b.text || <span className="wf-ghost">Empty</span>}</span>;
        if (b.kind === "link")
          return (
            <span key={i} className="wf-lk">
              <WfIcon name="link" size={11} />
              {b.resourceSlug ? resourceName(ctx, b.resourceSlug) : b.url ? b.url.replace(/^https?:\/\//, "") : "Link"}
            </span>
          );
        if (b.kind === "image")
          return (
            <span key={i} className="wf-b wf-b-img">
              <WfIcon name="image" size={12} />
              Image
            </span>
          );
        return (
          <span key={i} className="wf-b">
            {b.text || <span className="wf-ghost">Buttons</span>}
          </span>
        );
      })}
      {bubbles.length > shown.length ? <span className="wf-b wf-b-more">+{bubbles.length - shown.length}</span> : null}
    </>
  );
}

function SaveChips({ node, ctx }: { node: GraphNode; ctx: BuilderContext }) {
  const keys = savesTo(node);
  if (!keys.length) return null;
  return (
    <span className="wf-saves">
      {keys.slice(0, 3).map((k) => {
        const f = ctx.fields.find((x) => x.key === k);
        const sync = syncTitle(f);
        return (
          <span key={k} className="wf-save-chip" title={sync ?? undefined}>
            {fieldLabel(ctx, k)}
            {sync ? <WfIcon name="sync" size={10} /> : null}
          </span>
        );
      })}
      {keys.length > 3 ? <span className="wf-save-chip">+{keys.length - 3}</span> : null}
    </span>
  );
}

function Body({ node, ctx }: { node: GraphNode; ctx: BuilderContext }) {
  switch (node.type) {
    case "trigger": {
      const d = node.data as StepData<"trigger">;
      return (
        <>
          <span className="wf-line1">
            <b>{TRIGGER_KIND_LABEL[d.kind]}</b>
            {d.keywords.length ? d.keywords.map((k) => <span key={k} className="wf-kw">{k}</span>) : <span className="wf-kw" data-empty="true">Keyword</span>}
          </span>
          {d.kind === "comment" ? <span className="wf-sub">{d.postIds === "any" ? "Any post" : `${d.postIds.length} post${d.postIds.length === 1 ? "" : "s"}`}</span> : null}
        </>
      );
    }
    case "message":
      return <Bubbles bubbles={(node.data as StepData<"message">).bubbles ?? []} ctx={ctx} />;
    case "wait": {
      const d = node.data as StepData<"wait">;
      const warn = waitWindowWarning(d);
      const what = d.mode === "delay" ? formatMinutes(d.minutes) || "Delay" : d.mode === "until_reply" ? "Until reply" : `Until ${d.fieldKey ? fieldLabel(ctx, d.fieldKey) : "field"}`;
      const max = d.mode !== "delay" && d.timeoutMinutes ? ` · ${formatMinutes(d.timeoutMinutes)}` : "";
      return (
        <span className="wf-line1">
          {what}
          {max}
          {warn ? (
            <span className="wf-warn-dot" title={warn} aria-label={warn} role="img" />
          ) : null}
        </span>
      );
    }
    case "ask": {
      const d = node.data as StepData<"ask">;
      return (
        <>
          <span className="wf-b">{d.question || <span className="wf-ghost">Question</span>}</span>
          <SaveChips node={node} ctx={ctx} />
        </>
      );
    }
    case "condition": {
      const d = node.data as StepData<"condition">;
      const rule = CONDITION_RULES.find((r) => r.kind === d.rule?.kind);
      return (
        <span className="wf-line1">
          {rule?.label ?? "Rule"}
          {rule?.needsValue ? <span className="wf-kw" data-empty={!d.rule.value || undefined}>{d.rule.value ? (d.rule.kind === "field_set" ? fieldLabel(ctx, d.rule.value) : d.rule.value) : "…"}</span> : null}
          {rule?.kind === "follows" ? "?" : null}
        </span>
      );
    }
    case "action": {
      const d = node.data as StepData<"action">;
      return (
        <span className="wf-ops">
          {(d.ops ?? []).map((o, i) => (
            <span key={i} className="wf-op">
              <WfIcon name={o.op === "friday" ? "wait" : "tag"} size={11} />
              {o.op === "friday" ? "Follow-up Friday" : o.op === "set_field" ? `${o.key ? fieldLabel(ctx, o.key) : "field"} = ${o.value ?? ""}` : `${o.op === "remove_tag" ? "−" : "+"} ${o.key || "tag"}`}
            </span>
          ))}
        </span>
      );
    }
    case "setter": {
      const d = node.data as StepData<"setter">;
      return (
        <>
          {d.leadMagnet.mode !== "none" && d.leadMagnet.resources.length ? (
            <span className="wf-sub">
              <WfIcon name="doc" size={11} />
              {d.leadMagnet.resources.map((r) => resourceName(ctx, r)).join(", ")}
            </span>
          ) : null}
          <SaveChips node={node} ctx={ctx} />
        </>
      );
    }
    case "goto": {
      const d = node.data as StepData<"goto">;
      return <span className="wf-line1">{ctx.workflows.find((w) => w.id === d.workflowId)?.name ?? <span className="wf-ghost">Workflow</span>}</span>;
    }
    default:
      return null;
  }
}

function StepNodeView({ data, selected }: NodeProps<StepNodeType>) {
  const { node, problems, ctx } = data;
  const ports = safePorts(node);
  const stat = nodeStatText(ctx.stats?.nodes[node.id]);
  const portCounts = ctx.stats?.ports[node.id] ?? {};
  const multi = ports.length > 1 || (ports.length === 1 && ports[0] !== "next");
  const setter = node.type === "setter" ? setterOf(ctx, (node.data as StepData<"setter">).setterId) : null;
  const head =
    node.type === "setter" ? `${setter?.name ?? "J"} · ${setterSummary(node.data as StepData<"setter">)}` : STEP_LABEL[node.type];
  const branchStats = node.type === "randomizer" ? ctx.stats?.branches[node.id] : undefined;

  return (
    <div
      className="wf-node"
      data-type={node.type}
      data-selected={selected || undefined}
      data-problem={problems.length ? "true" : undefined}
      style={{ width: WIDTH[node.type] ?? 220 }}
      title={problems.length ? problems.join(" · ") : undefined}
      role="group"
      aria-label={`${head}${problems.length ? `: ${problems.join(", ")}` : ""}`}
    >
      {node.type !== "trigger" ? <Handle type="target" position={Position.Left} id="in" className="wf-handle wf-handle-in" /> : null}
      <div className="wf-nh">
        {node.type === "setter" ? (
          <span className="wf-setter-dot" aria-hidden="true">
            {(setter?.name ?? "J").charAt(0).toUpperCase()}
          </span>
        ) : (
          <WfIcon name={node.type} size={13} />
        )}
        <span className="wf-nh-label">{head}</span>
        {stat.n ? (
          <span className="wf-stat">
            {stat.n}
            {stat.pct ? <span> · {stat.pct}</span> : null}
          </span>
        ) : null}
      </div>
      <div className="wf-nb">
        <Body node={node} ctx={ctx} />
      </div>
      {problems.length ? <span className="wf-node-problem">{problems[0]}</span> : null}
      {multi ? (
        <div className="wf-ports">
          {ports.map((p) => {
            const label = portLabel(node, p);
            const branch = p.startsWith("branch:") ? (node.data as StepData<"randomizer">).branches.find((b) => `branch:${b.id}` === p) : null;
            const n = branch ? branchStats?.[branch.id]?.reached : portCounts[p];
            return (
              <div key={p} className="wf-port" data-port={p}>
                <span className="wf-port-label">
                  {branch ? <b>{branch.label}</b> : label}
                  {branch ? <span className="wf-port-w">{branch.weight}%</span> : null}
                </span>
                {n !== undefined ? <span className="wf-port-n">{n}</span> : null}
                <Handle type="source" position={Position.Right} id={p} className="wf-handle" />
              </div>
            );
          })}
        </div>
      ) : ports.length === 1 ? (
        <Handle type="source" position={Position.Right} id="next" className="wf-handle wf-handle-next" />
      ) : null}
    </div>
  );
}

export const StepNode = memo(StepNodeView);
