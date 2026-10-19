"use client";

// Setup › Voice corrections: one compact card per correction (J wrote / You
// sent / Why), newest first. Add one by hand; remove saves at once.

import { useState } from "react";
import { saveSetter } from "@/app/(os)/os/knowledge/actions";
import { Field, Section, TextArea, TextInput, useSaver } from "@/components/os/knowledge/fields";
import type { SetterEditorView } from "@/lib/os/knowledge";
import { correctionBody, correctionPair } from "@/lib/os/setter/knowledge/corrections";
import type { VoiceCorrection } from "@/lib/os/setter/profile";

export default function CorrectionsCards({ view }: { view: SetterEditorView }) {
  const [list, setList] = useState<VoiceCorrection[]>(view.voiceCorrections);
  const [draft, setDraft] = useState({ wrote: "", sent: "", why: "" });
  const [adding, setAdding] = useState(false);
  const saver = useSaver();

  function persist(next: VoiceCorrection[], ok: string, after?: () => void) {
    const prev = list;
    setList(next);
    saver.run(async () => {
      const r = await saveSetter(view.id, { voiceCorrections: next });
      if (r.error) setList(prev);
      else after?.();
      return r;
    }, ok);
  }

  function add() {
    if (!draft.wrote.trim() || !draft.sent.trim()) return;
    const today = new Date().toISOString().slice(0, 10);
    const entry = { title: `Correction ${list.length + 1} (${today})`, body: correctionBody(draft) };
    persist([...list, entry], "Added", () => {
      setDraft({ wrote: "", sent: "", why: "" });
      setAdding(false);
    });
  }

  return (
    <Section
      id="corrections"
      title="Voice corrections"
      description="Drafts J wrote that you rewrote. J reads the 25 newest on every draft. Your version is the target."
      aside={
        <span className="kb-ap-row">
          <span className="kb-note" role="status" data-kind={saver.note?.kind}>
            {saver.pending ? "Saving…" : saver.note?.text}
          </span>
          {!adding && (
            <button type="button" className="kb-btn" onClick={() => setAdding(true)}>
              Add
            </button>
          )}
        </span>
      }
    >
      {adding && (
        <div className="os-kb-new-correction">
          <Field label="J wrote">{(id) => <TextArea id={id} rows={3} value={draft.wrote} onChange={(x) => setDraft({ ...draft, wrote: x })} />}</Field>
          <Field label="You sent">{(id) => <TextArea id={id} rows={3} value={draft.sent} onChange={(x) => setDraft({ ...draft, sent: x })} />}</Field>
          <Field label="Why (optional)" wide>
            {(id) => <TextInput id={id} value={draft.why} onChange={(x) => setDraft({ ...draft, why: x })} />}
          </Field>
          <div className="kb-ap-row">
            <button type="button" className="kb-btn" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button type="button" className="kb-btn kb-btn-p" disabled={!draft.wrote.trim() || !draft.sent.trim() || saver.pending} onClick={add}>
              Add correction
            </button>
          </div>
        </div>
      )}
      {!list.length && !adding && <p className="kb-quiet">None yet. They appear here when you edit J&apos;s draft before sending.</p>}
      <ol className="kb-corr">
        {[...list.entries()].reverse().map(([i, c]) => {
          const p = correctionPair(c);
          return (
            <li key={`${i}:${c.title}`} className="kb-corr-card">
              <div className="kb-corr-h">
                <span className="kb-quiet">{p.who || c.title}</span>
                <div className="kb-grow" />
                <button
                  type="button"
                  className="os-link quiet"
                  aria-label={`Remove ${c.title}`}
                  disabled={saver.pending}
                  onClick={() => persist(list.filter((_, j) => j !== i), "Removed")}
                >
                  Remove
                </button>
              </div>
              <dl>
                {p.wrote && (
                  <>
                    <dt>J wrote</dt>
                    <dd className="kb-corr-was">{p.wrote}</dd>
                  </>
                )}
                {p.sent && (
                  <>
                    <dt>You sent</dt>
                    <dd>{p.sent}</dd>
                  </>
                )}
                {p.why && (
                  <>
                    <dt>Why</dt>
                    <dd className="kb-corr-why">{p.why}</dd>
                  </>
                )}
              </dl>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}
