"use client";

// New setter: seven short questions → the drafter writes the starter docs →
// Kevin reviews (and can edit) every file before anything is saved. Saving
// creates a new setter; existing ones are never touched.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { draftNewSetter, saveNewSetter } from "@/app/(os)/os/knowledge/interview-actions";
import { KbIcon } from "@/components/os/knowledge/icons";
import { CopySetter } from "@/components/os/knowledge/setter-list-actions";
import type { SetterDraft } from "@/lib/os/setter/interview/generate";
import { answered, QUESTIONS, type Answers } from "@/lib/os/setter/interview/questions";
import { DOC_FILES, DOC_KEYS, type DocKey } from "@/lib/os/setter/knowledge/docs";

export default function SetterInterview({ setters }: { setters: { id: string; name: string }[] }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Answers>({});
  const [draft, setDraft] = useState<SetterDraft | null>(null);
  const [tab, setTab] = useState<DocKey | "funnel">("system_prompt");
  const [busy, setBusy] = useState<"draft" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const n = answered(answers);

  const write = async () => {
    setBusy("draft");
    setError(null);
    const r = await draftNewSetter(answers);
    setBusy(null);
    if (r.error || !r.draft) setError(r.error ?? "Couldn't write it.");
    else {
      setDraft(r.draft);
      setTab("system_prompt");
    }
  };

  const save = async () => {
    if (!draft) return;
    setBusy("save");
    setError(null);
    const r = await saveNewSetter(draft);
    if (r.error || !r.id) {
      setBusy(null);
      setError(r.error ?? "Couldn't save it.");
    } else router.push(`/os/knowledge/${r.id}`);
  };

  if (!draft) {
    return (
      <form
        className="kb-iv"
        onSubmit={(e) => {
          e.preventDefault();
          void write();
        }}
      >
        <label className="kb-iv-q">
          <span>Setter name</span>
          <input className="os-input" placeholder="e.g. J" maxLength={80} value={answers.name ?? ""} onChange={(e) => setAnswers({ ...answers, name: e.target.value })} />
        </label>
        {QUESTIONS.map((q, i) => (
          <label key={q.key} className="kb-iv-q">
            <span>
              <span className="kb-iv-n">{i + 1}</span>
              {q.q}
            </span>
            <textarea
              className="os-input"
              rows={q.key === "offers" || q.key === "resources" || q.key === "voice" ? 3 : 2}
              placeholder={q.hint}
              value={answers[q.key] ?? ""}
              onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })}
            />
          </label>
        ))}
        <div className="kb-iv-foot">
          <button type="submit" className="kb-btn kb-btn-p" disabled={n < 3 || busy !== null}>
            {busy === "draft" ? "Writing…" : "Write the docs"}
          </button>
          <span className="kb-quiet">{n}/7</span>
          <div className="kb-grow" />
          {setters.length > 0 && <CopySetter setters={setters} compact />}
        </div>
        {error && (
          <p className="kb-err" role="alert">
            {error}
          </p>
        )}
      </form>
    );
  }

  const setDoc = (k: DocKey, body: string) => setDraft({ ...draft, docs: { ...draft.docs, [k]: body } });

  return (
    <div className="kb-iv kb-iv-review">
      <div className="kb-iv-row">
        <input className="os-input kb-iv-name" aria-label="Setter name" maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        {draft.sample && <span className="kb-quiet">Sample</span>}
      </div>
      <div role="tablist" aria-label="Files" className="kb-switch kb-iv-tabs">
        {[...DOC_KEYS, "funnel" as const].map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className="kb-switch-tab" onClick={() => setTab(k)}>
            {k === "funnel" ? "Funnel" : DOC_FILES[k].file}
          </button>
        ))}
      </div>
      {tab === "funnel" ? (
        <div className="kb-iv-funnel">
          {draft.funnel.map((s, i) => (
            <label key={s.key} className="kb-iv-q">
              <span>{s.label}</span>
              <textarea
                className="os-input"
                rows={2}
                value={s.guidance}
                onChange={(e) => setDraft({ ...draft, funnel: draft.funnel.map((x, j) => (j === i ? { ...x, guidance: e.target.value } : x)) })}
              />
            </label>
          ))}
        </div>
      ) : (
        <textarea className="kb-rawarea kb-iv-doc" aria-label={DOC_FILES[tab].file} spellCheck value={draft.docs[tab]} onChange={(e) => setDoc(tab, e.target.value)} />
      )}
      {(draft.leadMagnets.length > 0 || draft.bookingLink) && (
        <ul className="kb-iv-extra">
          {draft.leadMagnets.map((m, i) => (
            <li key={i}>
              <KbIcon name="gift" size={12} />
              {m.name}
              {m.link && <span className="kb-quiet">{m.link}</span>}
            </li>
          ))}
          {draft.bookingLink && (
            <li>
              <KbIcon name="calendar" size={12} />
              Booking link
              <span className="kb-quiet">{draft.bookingLink}</span>
            </li>
          )}
        </ul>
      )}
      <div className="kb-iv-foot">
        <button type="button" className="kb-btn kb-btn-p" disabled={busy !== null || !draft.name.trim()} onClick={() => void save()}>
          {busy === "save" ? "Saving…" : "Save setter"}
        </button>
        <button type="button" className="kb-btn" disabled={busy !== null} onClick={() => setDraft(null)}>
          Back
        </button>
      </div>
      {error && (
        <p className="kb-err" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
