"use client";

// One setter's Setup pages (the left tree's lower half): Funnel, Lead magnets,
// Voice corrections, Tests, Autopilot and Profile. Each saves on its own, so
// an edit in one never overwrites another. The knowledge itself (voice,
// business, offers, objections, examples) is in the Markdown files.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteSetter, saveSetter, setDefaultFor, setLeadMagnet, type ActionResult, type SetterPatch } from "@/app/(os)/os/knowledge/actions";
import { Field, RepeatItem, Section, Select, Switch, TextArea, TextInput, useSaver } from "@/components/os/knowledge/fields";
import type { SetterEditorView } from "@/lib/os/knowledge";
import type { FunnelStage, VoiceCorrection } from "@/lib/os/setter/profile";
import BookingSetup from "@/components/os/knowledge/booking-setup";
import VoiceNotesSection from "@/components/os/knowledge/voice-notes-section";
import type { VoiceClipView } from "@/lib/os/voice/clips";

function useSection<T>(initial: T) {
  const [value, set] = useState<T>(initial);
  const [saved, setSaved] = useState(() => JSON.stringify(initial));
  const dirty = JSON.stringify(value) !== saved;
  const saver = useSaver();
  function save(patch: (v: T) => SetterPatch, action: (p: SetterPatch) => Promise<ActionResult>) {
    const snapshot = JSON.stringify(value);
    saver.run(async () => {
      const r = await action(patch(value));
      if (!r.error) setSaved(snapshot);
      return r;
    });
  }
  return { value, set, dirty, save, ...saver };
}

type SaveFn = (p: SetterPatch) => Promise<ActionResult>;

// ---------------------------------------------------------------- profile
export function ProfileSetup({ view, save }: { view: SetterEditorView; save: SaveFn }) {
  const s = view.settings;
  const sec = useSection({
    name: view.name,
    autonomy: view.autonomy,
    ig_username: s.ig_username ?? "",
    operator: s.operator ?? "",
    audience: (s.audience as string) || "b2b",
    allowed_emojis: (s.allowed_emojis ?? []).join(" "),
  });
  const v = sec.value;
  const set = (p: Partial<typeof v>) => sec.set({ ...v, ...p });
  const router = useRouter();
  const def = useSaver();
  const defaultValue = view.isDefault ? (view.instagramAccountId ?? "workspace") : "";
  const defaultOptions: [string, string][] = [
    ["", "Not a default"],
    ...view.accounts.map((a) => [a.id, `Default for @${a.username}`] as [string, string]),
    ["workspace", view.accounts.length ? "Default for the workspace (any account)" : "Default for this workspace"],
  ];
  return (
    <Section
      id="profile"
      title="Profile"
      description="Who this setter is and when it answers. The Setting Script (the method) is shared by every setter and ships with the app."
      onSave={() =>
        sec.save(
          (x) => ({
            name: x.name,
            autonomy: x.autonomy,
            settings: {
              ig_username: x.ig_username.replace(/^@/, "").trim(),
              operator: x.operator.trim(),
              audience: x.audience,
              allowed_emojis: x.allowed_emojis.split(/\s+/).filter(Boolean),
            },
          }),
          save
        )
      }
      dirty={sec.dirty}
      pending={sec.pending}
      note={sec.note}
    >
      <div className="os-kb-grid2">
        <Field label="Name">{(id) => <TextInput id={id} value={v.name} onChange={(x) => set({ name: x })} />}</Field>
        <Field label="Instagram handle" hint="The account J writes as.">
          {(id) => <TextInput id={id} value={v.ig_username} placeholder="claudepreneur" onChange={(x) => set({ ig_username: x })} />}
        </Field>
        <Field label="Operator" hint="J writes in first person as this person.">
          {(id) => <TextInput id={id} value={v.operator} onChange={(x) => set({ operator: x })} />}
        </Field>
        <Field label="Audience" hint="B2B: peer frame with owners. B2C: warm coach frame.">
          {(id) => (
            <Select
              id={id}
              value={v.audience}
              onChange={(x) => set({ audience: x })}
              options={[
                ["b2b", "B2B (business owners)"],
                ["b2c", "B2C (individuals)"],
              ]}
            />
          )}
        </Field>
        <Field label="Allowed emojis" hint="Separated by spaces. J uses no others.">
          {(id) => <TextInput id={id} value={v.allowed_emojis} onChange={(x) => set({ allowed_emojis: x })} />}
        </Field>
        <Field label="Sending" hint="Auto isn't built yet: every message is approved in the Inbox either way.">
          {(id) => (
            <Select
              id={id}
              value={v.autonomy}
              onChange={(x) => set({ autonomy: x as "approve" | "auto" })}
              options={[
                ["approve", "Approve every draft"],
                ["auto", "Auto (reserved)"],
              ]}
            />
          )}
        </Field>
      </div>
      <div className="os-kb-inline">
        <Field label="Answers by default" hint="New contacts on that account get this setter unless a campaign says otherwise.">
          {(id) => (
            <Select
              id={id}
              value={defaultValue}
              options={defaultOptions}
              onChange={(x) =>
                def.run(async () => {
                  const r = await setDefaultFor(view.id, x || null);
                  router.refresh();
                  return r;
                })
              }
            />
          )}
        </Field>
        <span role="status" className="os-kb-note" data-kind={def.note?.kind}>
          {def.pending ? "Saving…" : def.note?.text}
        </span>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- funnel
export function FunnelSetup({ view, save }: { view: SetterEditorView; save: SaveFn }) {
  const sec = useSection<FunnelStage[]>(view.funnel);
  const setStage = (i: number, p: Partial<FunnelStage>) => sec.set(sec.value.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...sec.value];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    sec.set(next);
  };
  return (
    <Section
      id="funnel"
      title="Funnel"
      description="The client journey, in order: what J asks at each stage. The method (pacing, one question at a time) stays fixed; this sets what to ask."
      onSave={() => sec.save((x) => ({ funnel: x.map((s) => ({ ...s, key: "" })) }), save)}
      dirty={sec.dirty}
      pending={sec.pending}
      note={sec.note}
    >
      <ol className="os-kb-list numbered">
        {sec.value.map((s, i) => (
          <RepeatItem key={i} removeLabel="Remove stage" onRemove={() => sec.set(sec.value.filter((_, j) => j !== i))}>
            <div className="os-kb-stage-head">
              <span className="os-kb-step">{i + 1}</span>
              <Field label="Stage">{(id) => <TextInput id={id} value={s.label} onChange={(x) => setStage(i, { label: x })} />}</Field>
              <div className="os-kb-move">
                <button type="button" className="os-button ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" className="os-button ghost" aria-label="Move down" disabled={i === sec.value.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
              </div>
            </div>
            <Field label="What J does here" wide>
              {(id) => <TextArea id={id} rows={4} value={s.guidance} onChange={(x) => setStage(i, { guidance: x })} />}
            </Field>
          </RepeatItem>
        ))}
      </ol>
      <button type="button" className="os-button" onClick={() => sec.set([...sec.value, { key: "", label: "", guidance: "" }])}>
        Add stage
      </button>
    </Section>
  );
}

// ---------------------------------------------------------------- lead magnets
export function LeadMagnetsSetup({ view }: { view: SetterEditorView }) {
  const [on, setOn] = useState(() => new Set(view.enabledResourceIds));
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const magnets = view.resources.filter((r) => r.kind === "resource");
  function toggle(id: string, next: boolean) {
    setError(null);
    const prev = new Set(on);
    const upd = new Set(on);
    if (next) upd.add(id);
    else upd.delete(id);
    setOn(upd); // optimistic: the switch moves on press
    start(async () => {
      const r = await setLeadMagnet(view.id, id, next);
      if (r.error) {
        setOn(prev);
        setError(r.error);
      }
    });
  }
  return (
    <Section
      id="lead-magnets"
      title="Lead magnets"
      description={
        <>
          The resources J may offer. Only <strong>active</strong> ones that are switched on reach J. Manage the list in{" "}
          <Link href="/os/knowledge/resources">Resources</Link>.
        </>
      }
    >
      {error && <p className="os-kb-note" data-kind="error">{error}</p>}
      {!magnets.length && <p className="os-kb-help">No resources yet. Add them in Resources.</p>}
      <ul className="os-kb-toggles">
        {magnets.map((r) => (
          <li key={r.id} data-off={on.has(r.id) ? undefined : "true"}>
            <div className="os-kb-toggle-text">
              <strong>{r.name}</strong>
              <span>
                <StatusChip status={r.status} />
                {r.link ? <span className="os-kb-url">{r.link}</span> : <span className="os-kb-url">No link yet</span>}
              </span>
            </div>
            <Switch checked={on.has(r.id)} onChange={(x) => toggle(r.id, x)} label={`J may offer ${r.name}`} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function StatusChip({ status }: { status: "ACTIVE" | "TEST" | "DRAFT" }) {
  const label = { ACTIVE: "Active", TEST: "Test", DRAFT: "Draft" }[status];
  return (
    <span className={`chip ${status === "ACTIVE" ? "" : "quiet"}`} data-status={status.toLowerCase()}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------- corrections
export function CorrectionsSetup({ view, save }: { view: SetterEditorView; save: SaveFn }) {
  const sec = useSection<VoiceCorrection[]>(view.voiceCorrections);
  const set = (i: number, p: Partial<VoiceCorrection>) => sec.set(sec.value.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const [draft, setDraft] = useState({ wrote: "", sent: "", why: "" });
  function addFromDraft() {
    if (!draft.wrote.trim() || !draft.sent.trim()) return;
    const quote = (t: string) =>
      t
        .trim()
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
    const body = `**J drafted:**\n\n${quote(draft.wrote)}\n\n**Sent instead:**\n\n${quote(draft.sent)}${draft.why.trim() ? `\n\n- **why:** ${draft.why.trim()}` : ""}`;
    const today = new Date().toISOString().slice(0, 10);
    sec.set([...sec.value, { title: `Correction ${sec.value.length + 1} (${today})`, body }]);
    setDraft({ wrote: "", sent: "", why: "" });
  }
  return (
    <Section
      id="corrections"
      title="Voice corrections"
      description="Drafts J wrote that you rewrote. J reads the 25 most recent on every draft and learns the pattern. The rewritten version is always the target."
      onSave={() => sec.save((x) => ({ voiceCorrections: x }), save)}
      dirty={sec.dirty}
      pending={sec.pending}
      note={sec.note}
    >
      <div className="os-kb-new-correction">
        <Field label="J wrote">{(id) => <TextArea id={id} rows={3} value={draft.wrote} onChange={(x) => setDraft({ ...draft, wrote: x })} />}</Field>
        <Field label="You sent">{(id) => <TextArea id={id} rows={3} value={draft.sent} onChange={(x) => setDraft({ ...draft, sent: x })} />}</Field>
        <Field label="Why (optional)" wide>
          {(id) => <TextInput id={id} value={draft.why} onChange={(x) => setDraft({ ...draft, why: x })} />}
        </Field>
        <div>
          <button type="button" className="os-button" disabled={!draft.wrote.trim() || !draft.sent.trim()} onClick={addFromDraft}>
            Add correction
          </button>
        </div>
      </div>
      <ul className="os-kb-list">
        {[...sec.value.entries()].reverse().map(([i, c]) => (
          <RepeatItem key={i} removeLabel="Remove correction" onRemove={() => sec.set(sec.value.filter((_, j) => j !== i))}>
            <details className="os-kb-details">
              <summary>{c.title || `Correction ${i + 1}`}</summary>
              <Field label="Title" wide>
                {(id) => <TextInput id={id} value={c.title} onChange={(x) => set(i, { title: x })} />}
              </Field>
              <Field label="What happened" wide>
                {(id) => <TextArea id={id} rows={10} value={c.body} onChange={(x) => set(i, { body: x })} mono />}
              </Field>
            </details>
          </RepeatItem>
        ))}
      </ul>
    </Section>
  );
}

export function DangerZone({ view }: { view: SetterEditorView }) {
  const saver = useSaver();
  const [confirming, setConfirming] = useState(false);
  return (
    <section className="os-kb-danger" aria-label="Delete">
      {!confirming ? (
        <button type="button" className="os-link quiet" onClick={() => setConfirming(true)}>
          Delete this knowledge base…
        </button>
      ) : (
        <div className="os-kb-inline">
          <span>
            Delete <strong>{view.name}</strong>? Its contacts go back to the account default.
          </span>
          <button type="button" className="os-button" onClick={() => setConfirming(false)}>
            Keep it
          </button>
          <button type="button" className="os-button danger" disabled={saver.pending} onClick={() => saver.run(() => deleteSetter(view.id))}>
            {saver.pending ? "Deleting…" : "Delete"}
          </button>
          {saver.note?.kind === "error" && <span className="os-kb-note" data-kind="error">{saver.note.text}</span>}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- tests
export function TestsSetup({ view }: { view: SetterEditorView }) {
  return (
    <Section id="tests" title="Tests" description="Line A/B tests: two versions of one line, split across new conversations. They live in Automations › Tests.">
      <p className="kb-line">
        <strong>{view.testsRunning}</strong> running for {view.name}
        <Link href="/os/automations/experiments" className="kb-btn">
          Open Tests
        </Link>
      </p>
    </Section>
  );
}

// ---------------------------------------------------------------- autopilot
export function AutopilotSetup({ view }: { view: SetterEditorView }) {
  return (
    <Section id="autopilot" title="Autopilot" description="Per stage, whether drafts send on their own. For now every draft waits for your Approve.">
      <ol className="kb-auto">
        {view.funnel.map((s, i) => (
          <li key={s.key || i}>
            <span className="kb-auto-n">{i + 1}</span>
            <span>{s.label}</span>
            <span className="kb-quiet">Approve</span>
          </li>
        ))}
      </ol>
      {!view.funnel.length && <p className="kb-quiet">Add funnel stages first.</p>}
    </Section>
  );
}

// ---------------------------------------------------------------- the pane
export type SetupPage = "funnel" | "lead-magnets" | "voice-notes" | "booking" | "tests" | "corrections" | "autopilot" | "profile";

/** The right pane for a Setup item. */
export default function SetupPane({ view, page, voiceClips = [], sampleData = false }: { view: SetterEditorView; page: SetupPage; voiceClips?: VoiceClipView[]; sampleData?: boolean }) {
  const save = (p: SetterPatch) => saveSetter(view.id, p);
  return (
    <div className="kb-setup">
      {page === "funnel" && <FunnelSetup view={view} save={save} />}
      {page === "lead-magnets" && <LeadMagnetsSetup view={view} />}
      {page === "voice-notes" && <VoiceNotesSection setterId={view.id} clips={voiceClips} sampleData={sampleData} />}
      {page === "booking" && <BookingSetup view={view} />}
      {page === "tests" && <TestsSetup view={view} />}
      {page === "corrections" && <CorrectionsSetup view={view} save={save} />}
      {page === "autopilot" && <AutopilotSetup view={view} />}
      {page === "profile" && (
        <>
          <ProfileSetup view={view} save={save} />
          <DangerZone view={view} />
        </>
      )}
    </div>
  );
}
