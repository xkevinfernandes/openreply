"use client";

// Knowledge base → Follow-ups: one card per sequence, a switch each, the
// steps one tap deeper. Each card saves on its own.

import { useState, useTransition } from "react";
import { saveFollowupSequence } from "@/app/(os)/os/knowledge/actions";
import { Field, Section, Switch, TextArea, TextInput } from "@/components/os/knowledge/fields";
import {
  SEQUENCE_KEYS,
  SEQUENCE_META,
  timingLabel,
  type Sequence,
  type SequenceKey,
  type SequenceSet,
  type SequenceStep,
  type StepTiming,
} from "@/lib/os/sequences/types";

const GROUPS: { id: "no_reply" | "booked" | "after_call"; title: string; lede: string }[] = [
  { id: "no_reply", title: "When they go quiet", lede: "Value first, then social proof, a direct ask, a breakup. Stops the moment they reply. Fits inside Instagram's 7-day window." },
  { id: "booked", title: "Booked, before the call", lede: "Times are in their timezone, counted from the booking or the call. A reschedule moves them, a cancel stops them." },
  { id: "after_call", title: "After the call", lede: "From the calendar, or when you mark Showed / No-show on the contact." },
];

const TIMING_NAMES: Record<StepTiming["kind"], string> = {
  after: "After a wait",
  day_before: "Day before, at",
  day_of: "On the day, at",
  before_call: "Before the call",
};

export default function FollowupsEditor({ setterId, sequences }: { setterId: string; sequences: SequenceSet }) {
  return (
    <Section
      id="follow-ups"
      title="Follow-ups"
      description="What J sends when nothing happens, before a call, and after it. Every step is a draft you approve, and J may hold if nothing natural fits."
    >
      {GROUPS.map((g) => (
        <div key={g.id} className="os-seq-group">
          <h3 className="os-kb-sub">{g.title}</h3>
          <p className="os-kb-help">{g.lede}</p>
          <ul className="os-seq-list">
            {SEQUENCE_KEYS.filter((k) => SEQUENCE_META[k].group === g.id).map((k) => (
              <SequenceCard key={k} setterId={setterId} initial={sequences[k]} />
            ))}
          </ul>
        </div>
      ))}
    </Section>
  );
}

function newStep(key: SequenceKey, n: number): SequenceStep {
  const kind = SEQUENCE_META[key].timings[0] ?? "after";
  const timing: StepTiming = kind === "day_before" || kind === "day_of" ? { kind, time: "09:00" } : { kind, minutes: 24 * 60 };
  return { id: `step-${Date.now().toString(36)}-${n}`, label: "New step", timing, intent: "", fixedLine: "", voicePhrase: "", resource: false };
}

function SequenceCard({ setterId, initial }: { setterId: string; initial: Sequence }) {
  const meta = SEQUENCE_META[initial.key];
  const [seq, setSeq] = useState(initial);
  const [saved, setSaved] = useState(() => JSON.stringify(initial));
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(seq) !== saved;

  function save(next: Sequence, ok = "Saved") {
    setNote(null);
    start(async () => {
      const r = await saveFollowupSequence(setterId, next.key, next);
      if (r.error) setNote({ kind: "error", text: r.error });
      else {
        setSaved(JSON.stringify(next));
        setNote({ kind: "ok", text: ok });
      }
    });
  }

  function toggle(on: boolean) {
    // The switch saves at once (with the saved steps, not half-edited ones).
    const base = { ...(JSON.parse(saved) as Sequence), enabled: on };
    setSeq((s) => ({ ...s, enabled: on }));
    save(base, on ? "On" : "Off: nothing more queues from it");
  }

  const setStep = (i: number, patch: Partial<SequenceStep>) => setSeq((s) => ({ ...s, steps: s.steps.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const move = (i: number, d: -1 | 1) =>
    setSeq((s) => {
      const steps = [...s.steps];
      const j = i + d;
      if (j < 0 || j >= steps.length) return s;
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...s, steps };
    });

  return (
    <li className="os-seq" data-off={seq.enabled ? undefined : "true"}>
      <div className="os-seq-head">
        <div className="os-kb-toggle-text">
          <strong>{meta.title}</strong>
          <span>{meta.blurb}</span>
        </div>
        <Switch checked={seq.enabled} onChange={toggle} label={`${meta.title} follow-ups`} disabled={pending} />
      </div>

      {meta.timings.length > 0 && (
        <>
          <ol className="os-seq-summary" aria-label="Steps">
            {seq.steps.map((s) => (
              <li key={s.id}>
                <span className="lbl">{s.label}</span>
                <span className="when">{timingLabel(s.timing)}</span>
                {s.fixedLine && <span className="chip quiet">Fixed line</span>}
                {s.resource && <span className="chip quiet">+ resource</span>}
                {s.voicePhrase && <span className="chip quiet">Voice</span>}
              </li>
            ))}
            {initial.key === "pre_call" && (
              <li className="os-seq-fixed">
                <span className="lbl">Confirmation</span>
                <span className="when">sent when J books</span>
              </li>
            )}
          </ol>
          <button type="button" className="os-link" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? "Close steps" : "Edit steps"}
          </button>
        </>
      )}

      {open && (
        <div className="os-seq-steps">
          <ol className="os-kb-list">
            {seq.steps.map((s, i) => (
              <li key={s.id} className="os-kb-item">
                <div className="os-kb-grid2">
                  <Field label="Step">{(id) => <TextInput id={id} value={s.label} onChange={(v) => setStep(i, { label: v })} />}</Field>
                  <Field label="When" hint={timingHint(initial.key, s.timing, i)}>
                    {(id) => <TimingInput id={id} timing={s.timing} kinds={meta.timings} onChange={(t) => setStep(i, { timing: t })} />}
                  </Field>
                </div>
                <Field label="What J should do" wide>
                  {(id) => <TextArea id={id} rows={3} value={s.intent} onChange={(v) => setStep(i, { intent: v })} />}
                </Field>
                <div className="os-kb-grid2">
                  <Field label="Fixed line (optional)" hint="Sent as written instead of J writing.">
                    {(id) => <TextInput id={id} value={s.fixedLine} placeholder="still good for tomorrow?" onChange={(v) => setStep(i, { fixedLine: v })} />}
                  </Field>
                  <Field label="Voice clip phrase (optional)" hint="A recorded clip with this line goes instead of the text.">
                    {(id) => <TextInput id={id} value={s.voicePhrase} placeholder="hey, still with me?" onChange={(v) => setStep(i, { voicePhrase: v })} />}
                  </Field>
                </div>
                <label className="os-seq-check">
                  <input type="checkbox" checked={s.resource} onChange={(e) => setStep(i, { resource: e.target.checked })} />
                  Attach a matching resource they haven&apos;t had (from this setter&apos;s lead magnets)
                </label>
                <div className="os-kb-item-foot">
                  <button type="button" className="os-link quiet" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                    ↑
                  </button>
                  <button type="button" className="os-link quiet" disabled={i === seq.steps.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                    ↓
                  </button>
                  <button type="button" className="os-link quiet" onClick={() => setSeq((x) => ({ ...x, steps: x.steps.filter((_, j) => j !== i) }))}>
                    Remove step
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <div className="os-seq-foot">
            <button type="button" className="os-button" disabled={seq.steps.length >= 8} onClick={() => setSeq((x) => ({ ...x, steps: [...x.steps, newStep(x.key, x.steps.length + 1)] }))}>
              Add step
            </button>
            <span role="status" className="os-kb-note" data-kind={note?.kind}>
              {note?.text ?? (dirty ? "Unsaved changes" : "")}
            </span>
            <button type="button" className="os-button primary" disabled={!dirty || pending} onClick={() => save(seq)}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
      {!open && note && (
        <span role="status" className="os-kb-note" data-kind={note.kind}>
          {note.text}
        </span>
      )}
    </li>
  );
}

function timingHint(key: SequenceKey, t: StepTiming, i: number): string {
  if (t.kind !== "after") return "Their timezone.";
  if (key === "pre_call") return "Counted from when they booked.";
  if (key === "no_show") return i === 0 ? "Counted from the end of the call." : "Counted from the step before.";
  return i === 0 ? "Counted from your last message." : "Counted from the step before.";
}

function TimingInput({ id, timing, kinds, onChange }: { id: string; timing: StepTiming; kinds: StepTiming["kind"][]; onChange: (t: StepTiming) => void }) {
  const isClock = timing.kind === "day_before" || timing.kind === "day_of";
  const minutes = "minutes" in timing ? timing.minutes : 60;
  const unit = minutes % 1440 === 0 ? 1440 : minutes % 60 === 0 ? 60 : 1;
  return (
    <span className="os-seq-timing">
      {kinds.length > 1 && (
        <span className="os-select">
          <select
            aria-label="Kind of timing"
            value={timing.kind}
            onChange={(e) => {
              const k = e.target.value as StepTiming["kind"];
              onChange(k === "day_before" || k === "day_of" ? { kind: k, time: k === "day_before" ? "17:00" : "09:00" } : { kind: k, minutes: k === "before_call" ? 120 : 120 });
            }}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {TIMING_NAMES[k]}
              </option>
            ))}
          </select>
        </span>
      )}
      {isClock ? (
        <input id={id} className="os-input" type="time" value={timing.time} onChange={(e) => onChange({ kind: timing.kind, time: e.target.value || "09:00" })} />
      ) : (
        <>
          <input
            id={id}
            className="os-input os-seq-num"
            type="number"
            min={1}
            value={Math.round(minutes / unit)}
            onChange={(e) => onChange({ kind: timing.kind as "after" | "before_call", minutes: Math.max(1, Number(e.target.value) || 1) * unit })}
          />
          <span className="os-select">
            <select aria-label="Unit" value={unit} onChange={(e) => onChange({ kind: timing.kind as "after" | "before_call", minutes: Math.round(minutes / unit) * Number(e.target.value) })}>
              <option value={1}>min</option>
              <option value={60}>hours</option>
              <option value={1440}>days</option>
            </select>
          </span>
        </>
      )}
    </span>
  );
}
