"use client";

// Setup › Funnel: per stage, what J does, and Approve ↔ Auto. Stage text
// saves with Save; the Autopilot switch saves at once. Testing a stage's
// wording lives in Setup › Tests (tracked line tests).

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveSetter } from "@/app/(os)/os/knowledge/actions";
import { setStageAutopilot } from "@/app/(os)/os/knowledge/setup-actions";
import { Field, RepeatItem, Section, TextArea, TextInput, useSaver } from "@/components/os/knowledge/fields";
import type { SetterEditorView } from "@/lib/os/knowledge";
import { slugify } from "@/lib/os/setter/kb";
import { CLEAN_TARGET, type FunnelStage, type StageAutopilot } from "@/lib/os/setter/profile";

/** What Save sends: keys re-derive from labels on the server. Legacy
 *  variations ride along untouched until they're migrated into a test. */
const forSave = (list: FunnelStage[]) => list.map((s) => ({ ...s, key: "" }));
const keyed = (list: FunnelStage[]) => list.map((s) => ({ ...s, key: slugify(s.label) }));

export default function FunnelSetup({ view }: { view: SetterEditorView }) {
  const router = useRouter();
  const [stages, setStages] = useState<FunnelStage[]>(view.funnel);
  const [saved, setSaved] = useState(() => JSON.stringify(view.funnel));
  const saver = useSaver();
  const dirty = JSON.stringify(stages) !== saved;

  const setStage = (i: number, p: Partial<FunnelStage>) => setStages((list) => list.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (i: number, d: -1 | 1) =>
    setStages((list) => {
      const next = [...list];
      const [x] = next.splice(i, 1);
      next.splice(i + d, 0, x);
      return next;
    });

  function save() {
    const next = keyed(stages);
    saver.run(async () => {
      const r = await saveSetter(view.id, { funnel: forSave(stages) });
      if (!r.error) {
        setStages(next);
        setSaved(JSON.stringify(next));
        router.refresh();
      }
      return r;
    });
  }

  /** The switch saved: mirror it in both the edit and the saved copy. */
  function autopilotSaved(key: string, mode: StageAutopilot) {
    const apply = (list: FunnelStage[]) =>
      list.map((s) => {
        if (s.key !== key) return s;
        const next: FunnelStage = { ...s };
        if (mode === "auto") next.autopilot = "auto";
        else delete next.autopilot;
        return next;
      });
    setStages(apply);
    setSaved((prev) => JSON.stringify(apply(JSON.parse(prev) as FunnelStage[])));
    router.refresh();
  }

  return (
    <Section
      id="funnel"
      title="Funnel"
      description="What J does at each stage, and whether J's drafts there wait for Approve."
      onSave={save}
      dirty={dirty}
      pending={saver.pending}
      note={saver.note}
    >
      <ol className="os-kb-list numbered">
        {stages.map((s, i) => (
          <RepeatItem key={i} removeLabel="Remove stage" onRemove={() => setStages((list) => list.filter((_, j) => j !== i))}>
            <div className="os-kb-stage-head">
              <span className="os-kb-step">{i + 1}</span>
              <Field label="Stage">{(id) => <TextInput id={id} value={s.label} onChange={(x) => setStage(i, { label: x })} />}</Field>
              <div className="os-kb-move">
                <button type="button" className="os-button ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" className="os-button ghost" aria-label="Move down" disabled={i === stages.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
              </div>
            </div>
            <Field label="What J does here" wide>
              {(id) => <TextArea id={id} rows={3} value={s.guidance} onChange={(x) => setStage(i, { guidance: x })} />}
            </Field>
            <AutopilotRow setterId={view.id} stage={s} stats={view.stageStats[s.key]} locked={dirty || !s.key} onSaved={autopilotSaved} />
          </RepeatItem>
        ))}
      </ol>
      <button type="button" className="os-button" onClick={() => setStages((list) => [...list, { key: "", label: "", guidance: "" }])}>
        Add stage
      </button>
    </Section>
  );
}

function AutopilotRow({
  setterId,
  stage,
  stats,
  locked,
  onSaved,
}: {
  setterId: string;
  stage: FunnelStage;
  stats?: { clean: number; auto: number };
  locked: boolean;
  onSaved: (key: string, mode: StageAutopilot) => void;
}) {
  const saver = useSaver();
  const [asking, setAsking] = useState(false);
  const mode: StageAutopilot = stage.autopilot === "auto" ? "auto" : "approve";
  const clean = stats?.clean ?? 0;
  const ready = clean >= CLEAN_TARGET;

  function set(next: StageAutopilot) {
    setAsking(false);
    saver.run(async () => {
      const r = await setStageAutopilot(setterId, stage.key, next);
      if (!r.error) onSaved(stage.key, next);
      return r;
    }, next === "auto" ? "Auto on" : "Approve");
  }
  function pick(next: StageAutopilot) {
    if (next === mode || saver.pending) return;
    if (next === "auto" && !ready) setAsking(true);
    else set(next);
  }

  return (
    <div className="kb-ap">
      <div className="kb-ap-row">
        <span className="kb-lbl">Autopilot</span>
        <div className="kb-seg" role="radiogroup" aria-label={`Autopilot for ${stage.label || "this stage"}`}>
          {(["approve", "auto"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} disabled={locked && mode !== m} title={locked ? "Save the funnel first" : undefined} onClick={() => pick(m)}>
              {m === "approve" ? "Approve" : "Auto"}
            </button>
          ))}
        </div>
        <span className="kb-quiet" data-ready={ready ? "true" : undefined} title="Clean approvals: J's draft sent without edits">
          {Math.min(clean, CLEAN_TARGET)}/{CLEAN_TARGET} clean
        </span>
        {(stats?.auto ?? 0) > 0 && <span className="kb-quiet">· {stats!.auto} sent by J</span>}
        <span className="kb-note" role="status" data-kind={saver.note?.kind}>
          {saver.pending ? "Saving…" : saver.note?.kind === "error" ? saver.note.text : ""}
        </span>
      </div>
      {asking && (
        <div className="kb-ap-ask" role="alertdialog" aria-label="Turn on Auto?">
          <span>
            Only {clean}/{CLEAN_TARGET} clean approvals here. J&apos;s drafts would send without you.
          </span>
          <button type="button" className="kb-btn" onClick={() => setAsking(false)}>
            Cancel
          </button>
          <button type="button" className="kb-btn kb-btn-p" onClick={() => set("auto")}>
            Turn on Auto
          </button>
        </div>
      )}
    </div>
  );
}
