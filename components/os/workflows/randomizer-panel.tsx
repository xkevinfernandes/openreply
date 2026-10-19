"use client";

// Randomizer inspector (WorkflowC board): the split, each branch's first
// step, the A vs B table and Pick winner (an undoable draft edit).

import { Group } from "@/components/os/workflows/controls";
import { abResults, addBranch, LINE_MIN_REACHED, removeBranch, setWeight } from "@/components/os/workflows/forms";
import { nodeById, pickBranchWinner, targetOf } from "@/components/os/workflows/graph-edit";
import type { InspectorProps } from "@/components/os/workflows/inspector";
import { WfIcon } from "@/components/os/workflows/icons";
import { InfoTip } from "@/components/os/ui";
import type { StepData } from "@/lib/os/workflows/graph";

type Props = InspectorProps & { data: StepData<"randomizer"> };

function firstWords(graph: InspectorProps["graph"], id: string | null): string | null {
  const n = nodeById(graph, id);
  if (!n) return null;
  if (n.type === "message") {
    const b = (n.data as StepData<"message">).bubbles?.find((x) => x.kind === "text" || x.kind === "buttons") as { text?: string } | undefined;
    return b?.text || "Message";
  }
  return n.type.charAt(0).toUpperCase() + n.type.slice(1);
}

export default function RandomizerPanel({ data, node, graph, ctx, onChange, onGraph, onClose }: Props) {
  const branches = data.branches;
  const res = abResults(data, ctx.stats?.branches[node.id] ?? {});
  const two = branches.length === 2;
  const set = (b: StepData<"randomizer">["branches"]) => onChange({ ...data, branches: b });

  return (
    <>
      <Group
        label="Split"
        aside={
          branches.length < 4 ? (
            <button type="button" className="wf-add" onClick={() => set(addBranch(branches))}>
              <WfIcon name="plus" size={11} />
              Branch
            </button>
          ) : null
        }
      >
        {two ? (
          <div className="wf-split">
            <div className="wf-split-labels">
              <span>
                <b>{branches[0].label}</b> {branches[0].weight}%
              </span>
              <span>
                <b>{branches[1].label}</b> {branches[1].weight}%
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={99}
              value={branches[0].weight}
              aria-label={`Split between ${branches[0].label} and ${branches[1].label}`}
              onChange={(e) => set(setWeight(branches, branches[0].id, Number(e.target.value)))}
            />
          </div>
        ) : (
          <div className="wf-lines">
            {branches.map((b) => (
              <span key={b.id} className="wf-field-row">
                <b className="wf-branch-badge">{b.label}</b>
                <input className="os-input wf-num" type="number" min={1} max={97} aria-label={`${b.label} %`} value={b.weight} onChange={(e) => set(setWeight(branches, b.id, Number(e.target.value)))} />
                %
                <span className="wf-grow" />
                <button type="button" className="wf-ghostbtn" aria-label={`Remove branch ${b.label}`} onClick={() => set(removeBranch(branches, b.id))}>
                  <WfIcon name="close" size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
      </Group>

      <div className="wf-branches">
        {branches.map((b) => {
          const words = firstWords(graph, targetOf(graph, node.id, `branch:${b.id}`));
          return (
            <div key={b.id} className="wf-branch">
              <span className="wf-field-row">
                <b className="wf-branch-badge" data-lead={res.leaderId === b.id || undefined}>
                  {b.label}
                </b>
                {res.leaderId === b.id ? (
                  <span className="wf-leading">
                    <WfIcon name="up" size={11} />
                    Leading
                  </span>
                ) : null}
              </span>
              {words ? <span className="wf-b">{words}</span> : <span className="wf-ghost">Draw an arrow from {b.label}</span>}
            </div>
          );
        })}
      </div>

      <div className="wf-ab" role="table" aria-label={branches.map((b) => b.label).join(" versus ")}>
        <div role="row" className="wf-ab-row wf-ab-head" style={{ gridTemplateColumns: `minmax(0,1fr) repeat(${branches.length}, minmax(0,1fr))` }}>
          <span role="columnheader" />
          {res.branches.map((b) => (
            <span key={b.id} role="columnheader">
              {b.label}
            </span>
          ))}
        </div>
        {res.rows.map((r) => (
          <div key={r.key} role="row" className="wf-ab-row" style={{ gridTemplateColumns: `minmax(0,1fr) repeat(${branches.length}, minmax(0,1fr))` }}>
            <span role="rowheader">{r.label}</span>
            {r.cells.map((c, i) => (
              <span key={i} role="cell" className="wf-ab-cell">
                <span>
                  <b>{c.n}</b>
                  <span className="wf-statpct">{c.pct}</span>
                </span>
                <span className="wf-fbar" data-lead={res.branches[i].id === res.leaderId || undefined}>
                  <span style={{ width: `${c.bar}%` }} />
                </span>
              </span>
            ))}
          </div>
        ))}
      </div>

      <div className="wf-field-row wf-ab-note">
        <span className="os-dot" data-tone={res.verdict.kind === "leader" ? "mark" : "neutral"} aria-hidden="true" />
        <span>{res.note}</span>
        <InfoTip label="About the result">{`${res.people} people so far. Judged on replies once ${LINE_MIN_REACHED} reached each branch, on bookings once each has 10.`}</InfoTip>
      </div>

      {res.people > 0 ? (
        <div className="wf-field-row">
          {(res.leaderId ? [res.branches.find((b) => b.id === res.leaderId)!, ...res.branches.filter((b) => b.id !== res.leaderId)] : res.branches).map((b, i) =>
            i === 0 ? (
              <button
                key={b.id}
                type="button"
                className="os-button wf-pick"
                title="Everyone goes down this branch. The other branch's steps are removed (Undo brings them back)."
                onClick={() => {
                  onGraph((g) => pickBranchWinner(g, node.id, b.id));
                  onClose();
                }}
              >
                <WfIcon name="up" size={12} />
                Pick winner: {b.label}
              </button>
            ) : (
              <button
                key={b.id}
                type="button"
                className="os-button wf-pick-alt"
                aria-label={`Pick ${b.label} instead`}
                title={`Pick ${b.label} instead`}
                onClick={() => {
                  onGraph((g) => pickBranchWinner(g, node.id, b.id));
                  onClose();
                }}
              >
                {b.label}
              </button>
            )
          )}
        </div>
      ) : null}
    </>
  );
}
