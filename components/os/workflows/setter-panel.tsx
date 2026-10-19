"use client";

// Setter step inspector (WorkflowA board): Setup (goal, lead magnet rule +
// resources, release checkboxes, second resource, quiet hours, saves to) ·
// Tests (J's line tests scoped to J or this workflow, the Knowledge bases
// pieces) · Stats (exits and releases).

import { useState } from "react";
import LineTests from "@/components/os/knowledge/line-tests";
import { resourceName, setterOf } from "@/components/os/workflows/context";
import { AddSelect, FieldChips, Group, ResourceSelect, Seg } from "@/components/os/workflows/controls";
import { EXIT_LABEL, RELEASE_RULES, safePorts, scopeLineRows, toggleIn, toggleRelease } from "@/components/os/workflows/forms";
import type { InspectorProps } from "@/components/os/workflows/inspector";
import { WfIcon } from "@/components/os/workflows/icons";
import { InfoTip } from "@/components/os/ui";
import { pct } from "@/lib/os/experiments/stats";
import { SETTER_EXITS, type StepData } from "@/lib/os/workflows/graph";

type Props = InspectorProps & { tab: "setup" | "tests" | "stats"; data: StepData<"setter"> };

export default function SetterPanel(props: Props) {
  if (props.tab === "tests") return <Tests {...props} />;
  if (props.tab === "stats") return <Stats {...props} />;
  return <Setup {...props} />;
}

function Setup({ data, ctx, node, graph, onChange }: Props) {
  const set = (patch: Partial<StepData<"setter">>) => onChange({ ...data, ...patch });
  const lm = data.leadMagnet;
  const setLm = (patch: Partial<StepData<"setter">["leadMagnet"]>) => set({ leadMagnet: { ...lm, ...patch } });
  const releases = ctx.stats?.releases[node.id] ?? {};
  const exits = ctx.stats?.ports[node.id] ?? {};
  const left = ctx.resources.filter((r) => !lm.resources.includes(r.slug));
  const setter = setterOf(ctx, data.setterId);

  return (
    <>
      {ctx.setters.length > 1 ? (
        <Group label="Setter">
          <select className="os-input wf-select" aria-label="Setter" value={data.setterId ?? ""} onChange={(e) => set({ setterId: e.target.value || undefined })}>
            <option value="">Default ({ctx.setters.find((s) => s.isDefault)?.name ?? ctx.setters[0]?.name})</option>
            {ctx.setters.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Group>
      ) : null}
      <Group label="Goal">
        <Seg
          label="Goal"
          value={data.goal}
          options={[
            { value: "book_call", label: "Book a call" },
            { value: "start_conversation", label: "Start a conversation" },
          ]}
          onChange={(goal) => set({ goal })}
        />
      </Group>
      <Group label="Lead magnet">
        <Seg
          label="Lead magnet"
          value={lm.mode}
          options={[
            { value: "hold", label: "Hold until release" },
            { value: "send_first", label: "Send first" },
            { value: "none", label: "None" },
          ]}
          onChange={(mode) => setLm({ mode })}
        />
        {lm.mode !== "none" ? (
          <div className="wf-chips">
            {lm.resources.map((slug) => (
              <span key={slug} className="wf-chip">
                <WfIcon name="doc" size={11} />
                {resourceName(ctx, slug)}
                <button type="button" className="wf-chip-x" aria-label={`Remove ${resourceName(ctx, slug)}`} onClick={() => setLm({ resources: toggleIn(lm.resources, slug) })}>
                  <WfIcon name="close" size={10} />
                </button>
              </span>
            ))}
            {left.length ? <AddSelect label="Lead magnet" options={left.map((r) => ({ value: r.slug, label: r.name }))} onPick={(slug) => setLm({ resources: [...lm.resources, slug] })} /> : null}
          </div>
        ) : null}
      </Group>
      {lm.mode === "hold" ? (
        <fieldset className="wf-fieldset">
          <legend className="wf-lab">
            Release when
            <InfoTip label="About release">{`${setter?.name ?? "J"} sends the held resource on whichever happens first. Quiet is ${data.quietHours[0]}–${data.quietHours[1]}h after their last message, inside the 24h window.`}</InfoTip>
          </legend>
          {RELEASE_RULES.map((r) => (
            <label key={r.key} className="wf-chk">
              <input type="checkbox" checked={data.release[r.key]} onChange={() => onChange(toggleRelease(data, r.key))} />
              <span className="wf-grow">{r.label}</span>
              {releases[r.key] !== undefined ? <span className="wf-count">{releases[r.key]}</span> : null}
            </label>
          ))}
          {data.release.quiet ? (
            <span className="wf-field-row wf-quiet">
              <span className="wf-lab">Quiet</span>
              <input
                className="os-input wf-num"
                type="number"
                min={1}
                max={23}
                aria-label="Quiet from (hours)"
                value={data.quietHours[0]}
                onChange={(e) => set({ quietHours: [clampH(e.target.value), Math.max(clampH(e.target.value), data.quietHours[1])] })}
              />
              –
              <input
                className="os-input wf-num"
                type="number"
                min={1}
                max={23}
                aria-label="Quiet to (hours)"
                value={data.quietHours[1]}
                onChange={(e) => set({ quietHours: [Math.min(data.quietHours[0], clampH(e.target.value)), clampH(e.target.value)] })}
              />
              h
            </span>
          ) : null}
        </fieldset>
      ) : null}
      {lm.mode !== "none" ? (
        <Group label="Nudge" tip="Optional. One extra message with a second resource, inside the window.">
          <ResourceSelect ctx={ctx} label="Second resource" value={lm.second} allowNone="No nudge" onChange={(second) => setLm({ second })} />
        </Group>
      ) : null}
      <Group label="Exits">
        <div className="wf-chips">
          {safePorts(node).map((p) => (
            <span key={p} className="wf-chip" data-linked={graph.edges.some((e) => e.from === node.id && e.fromPort === p) || undefined} title={graph.edges.some((e) => e.from === node.id && e.fromPort === p) ? undefined : "No arrow: the run ends here"}>
              {EXIT_LABEL[p.slice(5)]}
              {exits[p] !== undefined ? <span className="wf-count">{exits[p]}</span> : null}
            </span>
          ))}
        </div>
      </Group>
      <Group label="Saves to">
        <FieldChips ctx={ctx} value={data.saveTo ?? []} onChange={(saveTo) => set({ saveTo })} />
      </Group>
    </>
  );
}

function clampH(v: string): number {
  return Math.min(23, Math.max(1, Math.round(Number(v) || 1)));
}

function Tests({ data, ctx, workflowId }: Props) {
  const [scope, setScope] = useState<"setter" | "workflow">("setter");
  const setter = setterOf(ctx, data.setterId);
  if (!setter) return <p className="wf-empty">Add a setter in Knowledge bases first.</p>;
  const rows = ctx.lineTests[setter.id];
  return (
    <>
      <div className="wf-field-row">
        <Seg
          label="Test scope"
          value={scope}
          options={[
            { value: "setter", label: `All of ${setter.name}` },
            { value: "workflow", label: "This workflow" },
          ]}
          onChange={setScope}
        />
        <InfoTip label="About tests">{`Each person gets A or B the first time ${setter.name} reaches the line, and keeps it. Only messages that went out count.`}</InfoTip>
      </div>
      {rows ? (
        <div className="wf-lt">
          <LineTests bare setterId={setter.id} setterName={setter.name} rows={scopeLineRows(rows, scope, workflowId)} workflowId={scope === "workflow" ? workflowId : undefined} />
        </div>
      ) : (
        <p className="wf-empty">Tests didn&apos;t load. Refresh in a minute.</p>
      )}
    </>
  );
}

function Stats({ ctx, node }: Props) {
  const reached = ctx.stats?.nodes[node.id]?.reached ?? 0;
  const exits = ctx.stats?.ports[node.id] ?? {};
  const releases = ctx.stats?.releases[node.id] ?? {};
  return (
    <>
      <Group label="Exits">
        <div className="wf-lines">
          {SETTER_EXITS.filter((e) => exits[`exit:${e}`] !== undefined).map((e) => (
            <div key={e} className="wf-statline">
              <span className="wf-grow">{EXIT_LABEL[e]}</span>
              <b>{exits[`exit:${e}`]}</b>
              <span className="wf-statpct">{reached ? pct((exits[`exit:${e}`] ?? 0) / reached) : ""}</span>
            </div>
          ))}
          {!Object.keys(exits).length ? <span className="wf-empty">No one yet</span> : null}
        </div>
      </Group>
      {Object.keys(releases).length ? (
        <Group label="Releases">
          <div className="wf-lines">
            {RELEASE_RULES.map((r) => (
              <div key={r.key} className="wf-statline">
                <span className="wf-grow">{r.label}</span>
                <b>{releases[r.key] ?? 0}</b>
                <span className="wf-statpct" />
              </div>
            ))}
          </div>
        </Group>
      ) : null}
    </>
  );
}
