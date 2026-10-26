"use client";

// The add/edit sheet for one resource: its fields plus the agents that may
// offer it. A component on its own (onSaved hands back the saved resource)
// so the broadcast picker can open it too (Part C 024).

import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { ResourceForm } from "@/app/(os)/os/knowledge/actions";
import { saveResourceSheet, type SavedResource } from "@/app/(os)/os/resources/actions";
import { removeAgentQuestion, saveSheet } from "@/lib/os/resource-sheet";
import type { ResourceRow } from "@/lib/os/resources-view";

export const EMPTY_RESOURCE: ResourceForm = { name: "", kind: "resource", link: "", keyword: "", status: "ACTIVE", description: "", when: "" };

export function formOf(r: ResourceRow): ResourceForm {
  return { id: r.id, name: r.name, kind: r.kind, link: r.link ?? "", keyword: r.keyword ?? "", status: r.status, description: r.description, when: r.when };
}

interface Props {
  initial?: ResourceForm;
  agents: { id: string; name: string }[];
  /** Agents ticked now (edit); every agent is ticked off for a new one. */
  agentIds?: string[];
  onSaved: (resource: SavedResource) => void;
  onClose: () => void;
  /** Edit only: opens the delete check. */
  onDelete?: () => void;
  /** Injected for tests; defaults to the server action. */
  save?: typeof saveResourceSheet;
}

export default function ResourceSheet({ initial = EMPTY_RESOURCE, agents, agentIds = [], onSaved, onClose, onDelete, save = saveResourceSheet }: Props) {
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const [f, setF] = useState<ResourceForm>(initial);
  const [ticked, setTicked] = useState<string[]>(agentIds);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (p: Partial<ResourceForm>) => setF((x) => ({ ...x, ...p }));
  const video = f.kind === "episode";

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open && typeof d.showModal === "function") d.showModal();
  }, []);

  const toggle = (agent: { id: string; name: string }, on: boolean) => {
    if (!on && agentIds.includes(agent.id) && !window.confirm(removeAgentQuestion(agent.name))) return;
    setTicked((t) => (on ? [...new Set([...t, agent.id])] : t.filter((x) => x !== agent.id)));
  };

  const submit = () =>
    start(async () => {
      setError(null);
      const err = await saveSheet(save, f, ticked, onSaved);
      if (err) return setError(err);
      onClose();
    });

  return (
    <dialog
      ref={ref}
      className="os-rs-sheet"
      aria-labelledby={`${id}-title`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <form
        className="os-rs-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2 id={`${id}-title`}>{f.id ? `Edit ${initial.name}` : "Add resource"}</h2>
        <div className="os-rs-grid">
          <label>
            <span>Name</span>
            <input className="os-input" value={f.name} onChange={(e) => set({ name: e.target.value })} required maxLength={160} autoFocus />
          </label>
          <label>
            <span>Kind</span>
            <select className="os-input" value={f.kind} onChange={(e) => set({ kind: e.target.value as ResourceForm["kind"] })} disabled={f.kind === "setter"}>
              <option value="resource">Lead magnet</option>
              <option value="episode">Video</option>
              {f.kind === "setter" ? <option value="setter">Entry path</option> : null}
            </select>
          </label>
          <label className="os-rs-wide">
            <span>Link</span>
            <input className="os-input" value={f.link} onChange={(e) => set({ link: e.target.value })} placeholder="https://" inputMode="url" />
          </label>
          {!video ? (
            <label>
              <span>Keyword</span>
              <input className="os-input" value={f.keyword} onChange={(e) => set({ keyword: e.target.value })} maxLength={80} />
            </label>
          ) : null}
          <label>
            <span>Status</span>
            <select className="os-input" value={f.status} onChange={(e) => set({ status: e.target.value as ResourceForm["status"] })}>
              <option value="ACTIVE">{video ? "On" : "Active"}</option>
              <option value="DRAFT">{video ? "Off" : "Draft"}</option>
              {!video ? <option value="TEST">Test</option> : null}
            </select>
          </label>
          {video ? (
            <label className="os-rs-wide">
              <span>When to share</span>
              <input className="os-input" value={f.when ?? ""} onChange={(e) => set({ when: e.target.value })} placeholder="Wants to build it themselves" maxLength={400} />
            </label>
          ) : (
            <label className="os-rs-wide">
              <span>{f.kind === "setter" ? "What J does when someone arrives this way" : "What J should know"}</span>
              <textarea className="os-textarea" rows={3} value={f.description} onChange={(e) => set({ description: e.target.value })} maxLength={4000} />
            </label>
          )}
        </div>
        {agents.length ? (
          <fieldset className="os-rs-agents">
            <legend>Agents that may offer it</legend>
            {agents.map((a) => (
              <label key={a.id} className="os-rs-agent">
                <input type="checkbox" checked={ticked.includes(a.id)} onChange={(e) => toggle(a, e.target.checked)} />
                {a.name}
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="os-tg-hint">No setters yet, so no agent can offer it. Add one in Setters.</p>
        )}
        {error ? (
          <p className="os-tg-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="os-tg-form-actions">
          {onDelete ? (
            <button type="button" className="os-button danger os-rs-del" onClick={onDelete} disabled={pending}>
              Delete
            </button>
          ) : null}
          <button type="button" className="os-button" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="os-button primary" disabled={pending || !f.name.trim()}>
            {pending ? "Saving…" : f.id ? "Save" : "Add"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
