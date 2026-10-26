"use client";

// The right-hand inspector (WorkflowA/C boards): one form per step type.
// Setter: Setup · Tests · Stats. Message, Ask and Trigger: Settings · Phone.

import { useState } from "react";
import type { BuilderContext } from "@/components/os/workflows/context";
import { AddSelect, DurationInput, FieldSelect, Group, ResourceSelect, Seg } from "@/components/os/workflows/controls";
import {
  ACTION_OPS,
  addBubble,
  addButton,
  addOp,
  addOption,
  MAX_OPTIONS,
  CONDITION_RULES,
  moveBubble,
  normalizeBubbles,
  parseKeywords,
  removeBubble,
  removeButton,
  removeOp,
  removeOption,
  setButtonLabel,
  setOptionLabel,
  STEP_LABEL,
  updateBubble,
  updateOp,
  waitWindowWarning,
} from "@/components/os/workflows/forms";
import { AutoTextarea } from "@/components/os/workflows/autosize";
import { WfIcon } from "@/components/os/workflows/icons";
import PhonePreview from "@/components/os/workflows/phone-preview";
import RandomizerPanel from "@/components/os/workflows/randomizer-panel";
import SetterPanel from "@/components/os/workflows/setter-panel";
import { nodeStatText } from "@/components/os/workflows/view";
import { InfoTip } from "@/components/os/ui";
import type { Bubble, GraphNode, StepData, WorkflowGraph } from "@/lib/os/workflows/graph";

export interface InspectorProps {
  workflowId: string;
  node: GraphNode;
  graph: WorkflowGraph;
  ctx: BuilderContext;
  problems: string[];
  onChange: (data: unknown) => void;
  onGraph: (fn: (g: WorkflowGraph) => WorkflowGraph) => void;
  onDelete: () => void;
  onClose: () => void;
}

const TIP: Partial<Record<GraphNode["type"], string>> = {
  trigger: "What starts the workflow. One keyword lives in one live workflow.",
  message: "Sends as written (no approval). A link is always its own bubble. Quick replies: one arrow per option; a typed answer J can't match leaves by Other.",
  wait: "Pauses the run. Past 24h after their last message, Instagram needs your approval.",
  ask: "Asks once, saves the answer to a field, then carries on even without one.",
  condition: "Splits by Yes / No.",
  action: "Tags and fields sync to Kit and GoHighLevel.",
  randomizer: "Splits people between branches, once per person. Pick winner keeps one branch.",
  setter: "J holds the conversation toward the goal and leaves by an exit.",
  goto: "Ends this run and starts the other workflow at its first step.",
  end: "The run ends here.",
};

type Tab = "settings" | "phone" | "setup" | "tests" | "stats";

export default function Inspector(props: InspectorProps) {
  const { node, ctx, problems, onDelete, onClose } = props;
  const isSetter = node.type === "setter";
  const hasPhone = node.type === "message" || node.type === "ask" || node.type === "trigger";
  const tabs: { key: Tab; label: string; icon: "settings" | "phone" | "tests" | "stats" }[] = isSetter
    ? [
        { key: "setup", label: "Setup", icon: "settings" },
        { key: "tests", label: "Tests", icon: "tests" },
        { key: "stats", label: "Stats", icon: "stats" },
      ]
    : hasPhone
      ? [
          { key: "settings", label: "Settings", icon: "settings" },
          { key: "phone", label: "Phone", icon: "phone" },
        ]
      : [];
  const [tab, setTab] = useState<Tab>(isSetter ? "setup" : "settings");
  const stat = nodeStatText(ctx.stats?.nodes[node.id]);

  return (
    <aside className="wf-insp" aria-label={`Inspector: ${STEP_LABEL[node.type]} step`}>
      <div className="wf-insp-top">
        {tabs.length ? (
          <div className="wf-tabbar" role="tablist" aria-label="Inspector view">
            {tabs.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>
                <WfIcon name={t.icon} size={13} />
                {t.label}
              </button>
            ))}
          </div>
        ) : (
          <span className="wf-grow" />
        )}
        {node.type !== "trigger" ? (
          <button type="button" className="wf-iconbtn" aria-label="Delete step" title="Delete step" onClick={onDelete}>
            <WfIcon name="trash" />
          </button>
        ) : null}
        <button type="button" className="wf-iconbtn" aria-label="Close inspector" title="Close" onClick={onClose}>
          <WfIcon name="close" />
        </button>
      </div>
      <div className="wf-insp-title">
        <WfIcon name={node.type} />
        <h2>{STEP_LABEL[node.type]}</h2>
        {TIP[node.type] ? <InfoTip label={`About ${STEP_LABEL[node.type]}`}>{TIP[node.type]}</InfoTip> : null}
        <span className="wf-grow" />
        {stat.n ? (
          <span className="wf-insp-stat">
            <b>{stat.n}</b> reached
          </span>
        ) : null}
      </div>
      {problems.length ? (
        <ul className="wf-insp-problems" role="alert">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      <div className="wf-insp-body" role={tabs.length ? "tabpanel" : undefined}>
        {isSetter ? (
          <SetterPanel {...props} tab={tab as "setup" | "tests" | "stats"} data={node.data as StepData<"setter">} />
        ) : tab === "phone" ? (
          <PhonePreview node={node} ctx={ctx} />
        ) : (
          <Form {...props} />
        )}
      </div>
    </aside>
  );
}

function Form(props: InspectorProps) {
  const { node } = props;
  switch (node.type) {
    case "trigger":
      return <TriggerForm {...props} data={node.data as StepData<"trigger">} />;
    case "message":
      return <MessageForm {...props} data={node.data as StepData<"message">} />;
    case "wait":
      return <WaitForm {...props} data={node.data as StepData<"wait">} />;
    case "ask":
      return <AskForm {...props} data={node.data as StepData<"ask">} />;
    case "condition":
      return <ConditionForm {...props} data={node.data as StepData<"condition">} />;
    case "action":
      return <ActionForm {...props} data={node.data as StepData<"action">} />;
    case "randomizer":
      return <RandomizerPanel {...props} data={node.data as StepData<"randomizer">} />;
    case "goto":
      return <GotoForm {...props} data={node.data as StepData<"goto">} />;
    default:
      return null;
  }
}

type FormProps<T> = InspectorProps & { data: T };

// ---------------------------------------------------------------- trigger
function TriggerForm({ data, onChange }: FormProps<StepData<"trigger">>) {
  const [kw, setKw] = useState(data.keywords.join(", "));
  const set = (patch: Partial<StepData<"trigger">>) => onChange({ ...data, ...patch });
  const replies = data.publicReplies ?? [];
  return (
    <>
      <Seg
        label="Trigger"
        value={data.kind}
        options={[
          { value: "comment", label: "Comment" },
          { value: "story_reply", label: "Story reply" },
          { value: "dm", label: "DM" },
        ]}
        onChange={(kind) => set({ kind })}
      />
      <Group label="Keywords">
        <input className="os-input" value={kw} placeholder="Pick a keyword" aria-label="Keywords" onChange={(e) => {
            setKw(e.target.value);
            set({ keywords: parseKeywords(e.target.value) });
          }} onBlur={() => setKw(parseKeywords(kw).join(", "))} />
      </Group>
      {data.kind === "comment" ? (
        <>
          <Group label="Posts">
            <Seg
              label="Posts"
              value={data.postIds === "any" ? "any" : "some"}
              options={[
                { value: "any", label: "Any post" },
                { value: "some", label: "These posts" },
              ]}
              onChange={(v) => set({ postIds: v === "any" ? "any" : [] })}
            />
            {data.postIds !== "any" ? (
              <input
                className="os-input"
                placeholder="Post IDs, comma separated"
                aria-label="Post IDs"
                defaultValue={data.postIds.join(", ")}
                onChange={(e) => set({ postIds: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              />
            ) : null}
          </Group>
          <Group label="Public replies" tip="One is picked at random for each comment.">
            {replies.map((r, i) => (
              <span key={i} className="wf-field-row">
                <input className="os-input" value={r} aria-label={`Public reply ${i + 1}`} onChange={(e) => set({ publicReplies: replies.map((x, j) => (j === i ? e.target.value : x)) })} />
                <button type="button" className="wf-iconbtn" aria-label="Remove reply" onClick={() => set({ publicReplies: replies.filter((_, j) => j !== i) })}>
                  <WfIcon name="close" size={12} />
                </button>
              </span>
            ))}
            <button type="button" className="wf-add" onClick={() => set({ publicReplies: [...replies, ""] })}>
              <WfIcon name="plus" size={11} />
              Reply
            </button>
          </Group>
        </>
      ) : null}
      <Group label="Again later" tip="When someone who finished comes back with the keyword. Before that, the link is re-sent once.">
        <span className="wf-field-row">
          <select
            className="os-input wf-select"
            aria-label="Re-entry"
            value={data.reentry?.mode ?? "after_days"}
            onChange={(e) => set({ reentry: { mode: e.target.value as "never" | "after_days" | "always", days: data.reentry?.days ?? 30 } })}
          >
            <option value="never">Never</option>
            <option value="after_days">After days</option>
            <option value="always">Always</option>
          </select>
          {(data.reentry?.mode ?? "after_days") === "after_days" ? (
            <input
              className="os-input wf-num"
              type="number"
              min={1}
              aria-label="Days"
              value={data.reentry?.days ?? 30}
              onChange={(e) => set({ reentry: { mode: "after_days", days: Math.max(1, Number(e.target.value) || 1) } })}
            />
          ) : null}
        </span>
      </Group>
    </>
  );
}

// ---------------------------------------------------------------- message
function MessageForm({ data, ctx, onChange }: FormProps<StepData<"message">>) {
  const bubbles = data.bubbles ?? [];
  const set = (b: Bubble[]) => onChange({ ...data, bubbles: b });
  return (
    <>
      <ol className="wf-bubbles">
        {bubbles.map((b, i) => (
          <li key={i} className="wf-bubble-edit" data-kind={b.kind}>
            <div className="wf-bubble-tools">
              <span className="wf-lab">{b.kind === "text" ? "Text" : b.kind === "link" ? "Link" : b.kind === "buttons" ? "Buttons" : b.kind === "quick_replies" ? "Quick replies" : "Image"}</span>
              <span className="wf-grow" />
              <button type="button" className="wf-ghostbtn" aria-label="Move up" disabled={i === 0} onClick={() => set(moveBubble(bubbles, i, -1))}>
                <WfIcon name="up" size={12} />
              </button>
              <button type="button" className="wf-ghostbtn" aria-label="Move down" disabled={i === bubbles.length - 1} onClick={() => set(moveBubble(bubbles, i, 1))}>
                <WfIcon name="down" size={12} />
              </button>
              <button type="button" className="wf-ghostbtn" aria-label="Remove bubble" onClick={() => set(removeBubble(bubbles, i))}>
                <WfIcon name="close" size={12} />
              </button>
            </div>
            {b.kind === "text" ? (
              <AutoTextarea
                className="os-input wf-bubble-text"
                rows={2}
                value={b.text}
                placeholder="hey {first_name}!"
                aria-label={`Bubble ${i + 1}`}
                onChange={(e) => set(updateBubble(bubbles, i, { kind: "text", text: e.target.value }))}
                onBlur={() => {
                  const next = normalizeBubbles(bubbles);
                  if (next.length !== bubbles.length) set(next);
                }}
              />
            ) : b.kind === "link" ? (
              <>
                <ResourceSelect ctx={ctx} value={b.resourceSlug} allowNone="Paste a URL" onChange={(slug) => set(updateBubble(bubbles, i, slug ? { kind: "link", resourceSlug: slug } : { kind: "link" }))} />
                {!b.resourceSlug ? (
                  <input
                    className="os-input"
                    placeholder="https://"
                    aria-label="Link URL"
                    value={b.url ?? ""}
                    onChange={(e) => set(updateBubble(bubbles, i, { kind: "link", url: e.target.value.trim() || undefined }))}
                  />
                ) : null}
              </>
            ) : b.kind === "buttons" ? (
              <>
                <AutoTextarea
                  className="os-input wf-bubble-text"
                  rows={2}
                  value={b.text}
                  placeholder="want me to send it?"
                  aria-label="Buttons text"
                  onChange={(e) => set(updateBubble(bubbles, i, { ...b, text: e.target.value }))}
                />
                <div className="wf-igbtns">
                  {b.buttons.map((x) => (
                    <span key={x.id} className="wf-igbtn">
                      <input value={x.label} maxLength={20} placeholder="Button" aria-label="Button label" onChange={(e) => set(setButtonLabel(bubbles, i, x.id, e.target.value))} />
                      <button type="button" className="wf-ghostbtn" aria-label="Remove button" onClick={() => set(removeButton(bubbles, i, x.id))}>
                        <WfIcon name="close" size={11} />
                      </button>
                    </span>
                  ))}
                  {b.buttons.length < 3 ? (
                    <button type="button" className="wf-add" onClick={() => set(addButton(bubbles, i))}>
                      <WfIcon name="plus" size={11} />
                      Button
                    </button>
                  ) : null}
                </div>
              </>
            ) : b.kind === "quick_replies" ? (
              <>
                <AutoTextarea
                  className="os-input wf-bubble-text"
                  rows={2}
                  value={b.text}
                  placeholder="what's holding you back right now?"
                  aria-label="Question"
                  onChange={(e) => set(updateBubble(bubbles, i, { ...b, text: e.target.value }))}
                />
                <div className="wf-igbtns">
                  {b.options.map((x) => (
                    <span key={x.id} className="wf-igbtn">
                      <input value={x.label} maxLength={20} placeholder="Option" aria-label="Option label" onChange={(e) => set(setOptionLabel(bubbles, i, x.id, e.target.value))} />
                      <button
                        type="button"
                        className="wf-ghostbtn"
                        aria-label="Counts as qualified"
                        aria-pressed={Boolean(x.qualifies)}
                        title={x.qualifies ? "Counts as qualified in By reel" : "Mark as qualified"}
                        style={{ opacity: x.qualifies ? 1 : 0.35 }}
                        onClick={() => set(updateBubble(bubbles, i, { ...b, options: b.options.map((o) => (o.id === x.id ? { ...o, qualifies: !o.qualifies || undefined } : o)) }))}
                      >
                        ★
                      </button>
                      <button type="button" className="wf-ghostbtn" aria-label="Remove option" onClick={() => set(removeOption(bubbles, i, x.id))}>
                        <WfIcon name="close" size={11} />
                      </button>
                    </span>
                  ))}
                  {b.options.length < MAX_OPTIONS ? (
                    <button type="button" className="wf-add" onClick={() => set(addOption(bubbles, i))}>
                      <WfIcon name="plus" size={11} />
                      Option
                    </button>
                  ) : null}
                </div>
                <Group label="Saves to" tip="The option they pick (or what they typed, after one retry).">
                  <FieldSelect ctx={ctx} value={b.saveTo ?? ""} label="Saves to" onChange={(saveTo) => set(updateBubble(bubbles, i, { ...b, saveTo: saveTo || undefined }))} />
                </Group>
              </>
            ) : (
              <input className="os-input" placeholder="Image URL" aria-label="Image URL" value={b.assetUrl} onChange={(e) => set(updateBubble(bubbles, i, { kind: "image", assetUrl: e.target.value }))} />
            )}
          </li>
        ))}
      </ol>
      <div className="wf-add-row">
        <button type="button" className="wf-add" onClick={() => set(addBubble(bubbles, "text"))}>
          <WfIcon name="plus" size={11} />
          Text
        </button>
        <button type="button" className="wf-add" onClick={() => set(addBubble(bubbles, "link"))}>
          <WfIcon name="link" size={11} />
          Link
        </button>
        {!bubbles.some((b) => b.kind === "buttons" || b.kind === "quick_replies") ? (
          <>
            <button type="button" className="wf-add" onClick={() => set(addBubble(bubbles, "buttons"))}>
              <WfIcon name="plus" size={11} />
              Buttons
            </button>
            <button type="button" className="wf-add" onClick={() => set(addBubble(bubbles, "quick_replies"))}>
              <WfIcon name="plus" size={11} />
              Quick replies
            </button>
          </>
        ) : null}
        <button type="button" className="wf-add" onClick={() => set(addBubble(bubbles, "image"))}>
          <WfIcon name="image" size={11} />
          Image
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- wait
function WaitForm({ data, ctx, onChange }: FormProps<StepData<"wait">>) {
  const set = (patch: Partial<StepData<"wait">>) => onChange({ ...data, ...patch });
  const warn = waitWindowWarning(data);
  return (
    <>
      <Seg
        label="Wait"
        value={data.mode}
        options={[
          { value: "delay", label: "Delay" },
          { value: "until_reply", label: "Until reply" },
          { value: "until_field", label: "Until field" },
        ]}
        onChange={(mode) =>
          onChange(mode === "delay" ? { mode, minutes: data.minutes ?? 60 } : { mode, timeoutMinutes: data.timeoutMinutes ?? 1440, ...(mode === "until_field" ? { fieldKey: data.fieldKey ?? "email" } : {}) })
        }
      />
      {data.mode === "delay" ? (
        <Group label="For">
          <DurationInput label="Delay" value={data.minutes} onChange={(minutes) => set({ minutes })} placeholder="1h" />
        </Group>
      ) : (
        <>
          {data.mode === "until_field" ? (
            <Group label="Until filled">
              <FieldSelect ctx={ctx} value={data.fieldKey ?? ""} onChange={(fieldKey) => set({ fieldKey })} />
            </Group>
          ) : null}
          <Group label="Give up after" tip="Then the run leaves by the No reply arrow.">
            <DurationInput label="Give up after" value={data.timeoutMinutes} onChange={(timeoutMinutes) => set({ timeoutMinutes })} />
          </Group>
        </>
      )}
      {warn ? (
        <p className="wf-warn" role="status">
          <span className="os-dot" data-tone="warn" aria-hidden="true" />
          {warn}
        </p>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- ask
function AskForm({ data, ctx, onChange }: FormProps<StepData<"ask">>) {
  const set = (patch: Partial<StepData<"ask">>) => onChange({ ...data, ...patch });
  return (
    <>
      <Group label="Question">
        <AutoTextarea className="os-input wf-bubble-text" rows={2} value={data.question} placeholder="what's the best email for extras?" aria-label="Question" onChange={(e) => set({ question: e.target.value })} />
      </Group>
      <Group label="Saves to">
        <FieldSelect ctx={ctx} value={data.saveTo} label="Saves to" onChange={(saveTo) => set({ saveTo, validate: saveTo === "email" ? "email" : data.validate === "email" ? "text" : data.validate })} />
      </Group>
      <Seg
        label="Answer type"
        value={data.validate ?? "text"}
        options={[
          { value: "email", label: "Email" },
          { value: "text", label: "Text" },
          { value: "number", label: "Number" },
        ]}
        onChange={(validate) => set({ validate })}
      />
      <Group label="If it looks wrong" tip="Asked once more, then the run carries on without it.">
        <AutoTextarea className="os-input wf-bubble-text" rows={1} minPx={44} value={data.retry ?? ""} placeholder="hmm, mind checking that?" aria-label="Retry message" onChange={(e) => set({ retry: e.target.value || undefined })} />
      </Group>
    </>
  );
}

// ---------------------------------------------------------------- condition
function ConditionForm({ data, ctx, onChange }: FormProps<StepData<"condition">>) {
  const rule = data.rule ?? { kind: "follows" };
  const meta = CONDITION_RULES.find((r) => r.kind === rule.kind);
  const set = (r: StepData<"condition">["rule"]) => onChange({ ...data, rule: r });
  return (
    <>
      <Group label="If">
        <select className="os-input wf-select" aria-label="Rule" value={rule.kind} onChange={(e) => set({ kind: e.target.value as typeof rule.kind })}>
          {CONDITION_RULES.map((r) => (
            <option key={r.kind} value={r.kind}>
              {r.label}
            </option>
          ))}
        </select>
        {meta?.needsValue ? (
          rule.kind === "field_set" ? (
            <FieldSelect ctx={ctx} value={rule.value ?? ""} onChange={(value) => set({ ...rule, value })} />
          ) : (
            <input className="os-input" aria-label="Value" placeholder={rule.kind === "tag" ? "tag" : rule.kind === "stage" ? "Qualify" : "SETTER"} value={rule.value ?? ""} onChange={(e) => set({ ...rule, value: e.target.value })} />
          )
        ) : null}
      </Group>
      <div className="wf-chips">
        <span className="wf-chip">Yes</span>
        <span className="wf-chip">No</span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- action
function ActionForm({ data, ctx, onChange }: FormProps<StepData<"action">>) {
  const ops = data.ops ?? [];
  const set = (o: StepData<"action">["ops"]) => onChange({ ...data, ops: o });
  return (
    <>
      <ol className="wf-ops-edit">
        {ops.map((o, i) => (
          <li key={i} className="wf-op-edit">
            <select className="os-input wf-select" aria-label="Action" value={o.op} onChange={(e) => set(updateOp(ops, i, { op: e.target.value as typeof o.op }))}>
              {ACTION_OPS.map((a) => (
                <option key={a.op} value={a.op}>
                  {a.label}
                </option>
              ))}
            </select>
            {o.op === "add_tag" || o.op === "remove_tag" ? (
              <input className="os-input" aria-label="Tag" placeholder="tag" value={o.key ?? ""} onChange={(e) => set(updateOp(ops, i, { key: e.target.value.trim() }))} />
            ) : o.op === "set_field" ? (
              <>
                <FieldSelect ctx={ctx} value={o.key ?? ""} onChange={(key) => set(updateOp(ops, i, { key }))} />
                <input className="os-input" aria-label="Value" placeholder="value" value={o.value ?? ""} onChange={(e) => set(updateOp(ops, i, { value: e.target.value }))} />
              </>
            ) : null}
            <button type="button" className="wf-ghostbtn" aria-label="Remove action" onClick={() => set(removeOp(ops, i))}>
              <WfIcon name="close" size={12} />
            </button>
          </li>
        ))}
      </ol>
      <AddSelect label="Action" options={ACTION_OPS.map((a) => ({ value: a.op, label: a.label }))} onPick={(op) => set(addOp(ops, op as (typeof ops)[number]["op"]))} />
    </>
  );
}

// ---------------------------------------------------------------- go to
function GotoForm({ data, ctx, workflowId, onChange }: FormProps<StepData<"goto">>) {
  const others = ctx.workflows.filter((w) => w.id !== workflowId);
  return (
    <Group label="Workflow">
      <select className="os-input wf-select" aria-label="Workflow" value={data.workflowId} onChange={(e) => onChange({ workflowId: e.target.value })}>
        <option value="">Pick a workflow</option>
        {others.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
    </Group>
  );
}
