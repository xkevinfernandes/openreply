"use client";

// One knowledge base: Setup, Voice, Offers, Funnel, Lead magnets, Examples,
// Voice corrections, Campaigns. Each section saves on its own, so an edit in
// one never overwrites another.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  deleteSetter,
  saveSetter,
  setCampaignSetter,
  setDefaultFor,
  setLeadMagnet,
  type ActionResult,
  type SetterPatch,
} from "@/app/(os)/os/knowledge/actions";
import FollowupsEditor from "@/components/os/knowledge/followups-editor";
import { Field, RepeatItem, Section, Select, Switch, TextArea, TextInput, useSaver } from "@/components/os/knowledge/fields";
import VoiceNotesSection from "@/components/os/knowledge/voice-notes-section";
import type { SetterEditorView } from "@/lib/os/knowledge";
import type { VoiceClipView } from "@/lib/os/voice/clips";
import { BUSINESS_FIELDS, type FunnelStage, type Objection, type Offer, type VoiceCorrection } from "@/lib/os/setter/profile";

export const SECTIONS = [
  ["setup", "Setup"],
  ["voice", "Voice"],
  ["voice-notes", "Voice notes"],
  ["offers", "Offers"],
  ["funnel", "Funnel"],
  ["lead-magnets", "Lead magnets"],
  ["examples", "Examples"],
  ["corrections", "Voice corrections"],
  ["campaigns", "Campaigns"],
  ["follow-ups", "Follow-ups"],
] as const;

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

export default function SetterEditor({ view, voiceClips = [], sampleData = false }: { view: SetterEditorView; voiceClips?: VoiceClipView[]; sampleData?: boolean }) {
  const save = (p: SetterPatch) => saveSetter(view.id, p);
  return (
    <div className="os-kb-editor">
      <nav className="os-kb-index" aria-label="Sections">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`}>
            {label}
          </a>
        ))}
      </nav>
      <div className="os-kb-sections">
        <SetupSection view={view} save={save} />
        <VoiceSection view={view} save={save} />
        <VoiceNotesSection setterId={view.id} clips={voiceClips} sampleData={sampleData} />
        <OffersSection view={view} save={save} />
        <FunnelSection view={view} save={save} />
        <LeadMagnetsSection view={view} />
        <ExamplesSection view={view} save={save} />
        <CorrectionsSection view={view} save={save} />
        <CampaignsSection view={view} />
        <FollowupsEditor setterId={view.id} sequences={view.sequences} />
        <DangerZone view={view} />
      </div>
    </div>
  );
}

type SaveFn = (p: SetterPatch) => Promise<ActionResult>;

// ---------------------------------------------------------------- setup
function SetupSection({ view, save }: { view: SetterEditorView; save: SaveFn }) {
  const s = view.profile.settings;
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
      id="setup"
      title="Setup"
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

// ---------------------------------------------------------------- voice
function VoiceSection({ view, save }: { view: SetterEditorView; save: SaveFn }) {
  const sec = useSection({ voice: view.profile.voice, voiceExamples: view.profile.voiceExamples });
  return (
    <Section
      id="voice"
      title="Voice"
      description="How this setter texts. Overrides the method's default voice rules."
      onSave={() => sec.save((x) => x, save)}
      dirty={sec.dirty}
      pending={sec.pending}
      note={sec.note}
    >
      <Field label="Voice rules" hint="Markdown. Energy, words they use, words they never use." wide>
        {(id) => <TextArea id={id} rows={14} value={sec.value.voice} onChange={(x) => sec.set({ ...sec.value, voice: x })} mono />}
      </Field>
      <Field label="Short examples" hint="A few lines in the voice. J learns the pattern, never copies them." wide>
        {(id) => <TextArea id={id} rows={8} value={sec.value.voiceExamples} onChange={(x) => sec.set({ ...sec.value, voiceExamples: x })} mono />}
      </Field>
    </Section>
  );
}

// ---------------------------------------------------------------- offers
const EMPTY_OFFER: Offer = { name: "", status: "draft", sold_by: "call", price_in_dms: "no", notes: "" };

function OffersSection({ view, save }: { view: SetterEditorView; save: SaveFn }) {
  const sec = useSection({
    offers: view.profile.offers,
    sections: view.profile.business.sections as Record<string, string>,
    objections: view.profile.business.objections,
  });
  const v = sec.value;
  const setOffer = (i: number, p: Partial<Offer>) => sec.set({ ...v, offers: v.offers.map((o, j) => (j === i ? { ...o, ...p } : o)) });
  const setObj = (i: number, p: Partial<Objection>) => sec.set({ ...v, objections: v.objections.map((o, j) => (j === i ? { ...o, ...p } : o)) });
  return (
    <Section
      id="offers"
      title="Offers"
      description="What J may invite to, and the facts it may state. A blank fact is told to J as unknown, so leaving one empty is safe; guessing is not."
      onSave={() =>
        sec.save((x) => ({ offers: x.offers, business: { sections: x.sections, objections: x.objections } }), save)
      }
      dirty={sec.dirty}
      pending={sec.pending}
      note={sec.note}
    >
      <h3 className="os-kb-sub">Offers J can invite to</h3>
      <p className="os-kb-help">J only ever invites to an open offer, and never mentions a closed one.</p>
      <ul className="os-kb-list">
        {v.offers.map((o, i) => (
          <RepeatItem key={i} removeLabel="Remove offer" onRemove={() => sec.set({ ...v, offers: v.offers.filter((_, j) => j !== i) })}>
            <div className="os-kb-grid2">
              <Field label="Name">{(id) => <TextInput id={id} value={o.name} onChange={(x) => setOffer(i, { name: x })} />}</Field>
              <Field label="Status">
                {(id) => (
                  <Select
                    id={id}
                    value={o.status}
                    onChange={(x) => setOffer(i, { status: x })}
                    options={[
                      ["open", "Open"],
                      ["draft", "Draft"],
                      ["closed", "Closed"],
                    ]}
                  />
                )}
              </Field>
              <Field label="Action" hint="What J does at the bridge.">
                {(id) => (
                  <Select
                    id={id}
                    value={o.sold_by}
                    onChange={(x) => setOffer(i, { sold_by: x })}
                    options={[
                      ["call", "Book a call"],
                      ["doc", "Send the offer doc"],
                      ["either", "Call or doc (you pick)"],
                    ]}
                  />
                )}
              </Field>
              <Field label="Price band" hint="e.g. 3.5k, $2k–5k">
                {(id) => <TextInput id={id} value={o.price ?? ""} onChange={(x) => setOffer(i, { price: x })} />}
              </Field>
              <Field label="Price in DMs">
                {(id) => (
                  <Select
                    id={id}
                    value={o.price_in_dms ?? "no"}
                    onChange={(x) => setOffer(i, { price_in_dms: x })}
                    options={[
                      ["no", "Never said in DMs"],
                      ["yes", "J may say it"],
                    ]}
                  />
                )}
              </Field>
              <Field label="Length">{(id) => <TextInput id={id} value={o.length ?? ""} onChange={(x) => setOffer(i, { length: x })} />}</Field>
              <Field label="Link" hint="The offer doc or sales page.">
                {(id) => <TextInput id={id} value={o.doc_url ?? ""} placeholder="https://" onChange={(x) => setOffer(i, { doc_url: x })} />}
              </Field>
              <Field label="Payment link">
                {(id) => <TextInput id={id} value={o.payment_url ?? ""} placeholder="https://" onChange={(x) => setOffer(i, { payment_url: x })} />}
              </Field>
              <Field label="Open from" hint="Optional, YYYY-MM-DD">
                {(id) => <TextInput id={id} type="date" value={o.open_from ?? ""} onChange={(x) => setOffer(i, { open_from: x })} />}
              </Field>
              <Field label="Open until" hint="Optional: closes after this day">
                {(id) => <TextInput id={id} type="date" value={o.open_until ?? ""} onChange={(x) => setOffer(i, { open_until: x })} />}
              </Field>
            </div>
            <Field label="Pitch" hint="One or two lines J can paraphrase." wide>
              {(id) => <TextArea id={id} rows={2} value={o.pitch ?? ""} onChange={(x) => setOffer(i, { pitch: x })} />}
            </Field>
            <Field label="Fit criteria" hint="Who this offer is right for. J uses it to pick between open offers." wide>
              {(id) => <TextArea id={id} rows={2} value={o.fit_criteria ?? ""} onChange={(x) => setOffer(i, { fit_criteria: x })} />}
            </Field>
            <Field label="Notes" hint="Anything else J should know about this offer." wide>
              {(id) => <TextArea id={id} rows={3} value={o.notes} onChange={(x) => setOffer(i, { notes: x })} />}
            </Field>
          </RepeatItem>
        ))}
      </ul>
      <button type="button" className="os-button" onClick={() => sec.set({ ...v, offers: [...v.offers, { ...EMPTY_OFFER }] })}>
        Add offer
      </button>

      <h3 className="os-kb-sub">The business</h3>
      <div className="os-kb-grid2">
        {BUSINESS_FIELDS.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint || undefined}>
            {(id) =>
              f.key === "booking_link" ? (
                <TextInput id={id} value={v.sections[f.key] ?? ""} placeholder="https://cal.com/…" onChange={(x) => sec.set({ ...v, sections: { ...v.sections, [f.key]: x } })} />
              ) : (
                <TextArea id={id} rows={3} value={v.sections[f.key] ?? ""} onChange={(x) => sec.set({ ...v, sections: { ...v.sections, [f.key]: x } })} />
              )
            }
          </Field>
        ))}
      </div>

      <h3 className="os-kb-sub">Objections</h3>
      <ul className="os-kb-list">
        {v.objections.map((o, i) => (
          <RepeatItem key={i} removeLabel="Remove objection" onRemove={() => sec.set({ ...v, objections: v.objections.filter((_, j) => j !== i) })}>
            <Field label="When they say" wide>
              {(id) => <TextInput id={id} value={o.objection} onChange={(x) => setObj(i, { objection: x })} />}
            </Field>
            <Field label="J answers" wide>
              {(id) => <TextArea id={id} rows={3} value={o.response} onChange={(x) => setObj(i, { response: x })} />}
            </Field>
          </RepeatItem>
        ))}
      </ul>
      <button type="button" className="os-button" onClick={() => sec.set({ ...v, objections: [...v.objections, { objection: "", response: "" }] })}>
        Add objection
      </button>
    </Section>
  );
}

// ---------------------------------------------------------------- funnel
function FunnelSection({ view, save }: { view: SetterEditorView; save: SaveFn }) {
  const sec = useSection<FunnelStage[]>(view.profile.funnel);
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
function LeadMagnetsSection({ view }: { view: SetterEditorView }) {
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

// ---------------------------------------------------------------- examples
function ExamplesSection({ view, save }: { view: SetterEditorView; save: SaveFn }) {
  const sec = useSection(view.profile.examples);
  return (
    <Section
      id="examples"
      title="Examples"
      description="Whole threads, opener to booked, in this setter's voice. J studies the rhythm and pacing; it never copies them."
      onSave={() => sec.save((x) => ({ examples: x }), save)}
      dirty={sec.dirty}
      pending={sec.pending}
      note={sec.note}
    >
      <Field label="Example threads" hint="Markdown. One ## heading per thread, then - prospect: / - setter: lines." wide>
        {(id) => <TextArea id={id} rows={18} value={sec.value} onChange={sec.set} mono />}
      </Field>
    </Section>
  );
}

// ---------------------------------------------------------------- corrections
function CorrectionsSection({ view, save }: { view: SetterEditorView; save: SaveFn }) {
  const sec = useSection<VoiceCorrection[]>(view.profile.voiceCorrections);
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

// ---------------------------------------------------------------- campaigns
function CampaignsSection({ view }: { view: SetterEditorView }) {
  const router = useRouter();
  const saver = useSaver();
  return (
    <Section
      id="campaigns"
      title="Campaigns"
      description="People who come in through a campaign checked here are answered by this setter instead of the account default. A contact keeps its setter."
    >
      {!view.campaigns.length && <p className="os-kb-help">No OpenReply campaigns in this workspace yet.</p>}
      <ul className="os-kb-toggles">
        {view.campaigns.map((c) => {
          const mine = c.setterId === view.id;
          return (
            <li key={c.id} data-off={mine ? undefined : "true"}>
              <div className="os-kb-toggle-text">
                <strong>{c.name}</strong>
                <span className="os-kb-url">{mine ? "Answered by this setter" : c.setterName ? `Answered by ${c.setterName}` : "Account default"}</span>
              </div>
              <Switch
                checked={mine}
                disabled={saver.pending}
                label={`${c.name} uses this setter`}
                onChange={(x) =>
                  saver.run(async () => {
                    const r = await setCampaignSetter(c.id, x ? view.id : null);
                    router.refresh();
                    return r;
                  })
                }
              />
            </li>
          );
        })}
      </ul>
      {saver.note?.kind === "error" && (
        <p className="os-kb-note" data-kind="error">
          {saver.note.text}
        </p>
      )}
    </Section>
  );
}

function DangerZone({ view }: { view: SetterEditorView }) {
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
