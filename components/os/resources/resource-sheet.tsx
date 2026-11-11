"use client";

// The add/edit sheet for one resource: its fields plus the agents that may
// offer it. A component on its own (onSaved hands back the saved resource)
// so the broadcast picker can open it too (Part C 024).

import { Button, Select } from "@claudepreneur/brand/react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { ResourceForm } from "@/app/(os)/os/knowledge/actions";
import { saveResourceSheet, type SavedResource } from "@/app/(os)/os/resources/actions";
import { removeAgentQuestion, saveSheet } from "@/lib/os/resource-sheet";
import type { ResourceRow } from "@/lib/os/resources-view";
import { useOsConfirm } from "@/components/os/ui/confirm";

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
  const confirmAsk = useOsConfirm();
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

  const toggle = async (agent: { id: string; name: string }, on: boolean) => {
    if (!on && agentIds.includes(agent.id) && !(await confirmAsk(removeAgentQuestion(agent.name), { danger: true, confirmLabel: "Remove" }))) return;
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
          <Select
            label="Kind"
            value={f.kind}
            onChange={(v) => set({ kind: v as ResourceForm["kind"] })}
            disabled={f.kind === "setter"}
            options={[
              { value: "resource", label: "Lead magnet" },
              { value: "episode", label: "Video" },
              ...(f.kind === "setter" ? [{ value: "setter", label: "Entry path" }] : []),
            ]}
          />
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
          <Select
            label="Status"
            value={f.status}
            onChange={(v) => set({ status: v as ResourceForm["status"] })}
            options={[
              { value: "ACTIVE", label: video ? "On" : "Active" },
              { value: "DRAFT", label: video ? "Off" : "Draft" },
              ...(!video ? [{ value: "TEST", label: "Test" }] : []),
            ]}
          />
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
            <Button variant="danger" className="os-rs-del" onClick={onDelete} disabled={pending}>
              Delete
            </Button>
          ) : null}
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending || !f.name.trim()}>
            {pending ? "Saving…" : f.id ? "Save" : "Add"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
