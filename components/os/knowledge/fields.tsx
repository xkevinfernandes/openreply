"use client";

// Small form kit for the Knowledge bases screens. Styles: the "Knowledge
// bases" section of app/(os)/os/os.css.

import { useId, useState, useTransition } from "react";
import type { ActionResult } from "@/app/(os)/os/knowledge/actions";
import { InfoTip } from "@/components/os/ui";

export function useSaver() {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  function run(fn: () => Promise<ActionResult>, ok = "Saved") {
    setNote(null);
    start(async () => {
      const r = await fn();
      setNote(r.error ? { kind: "error", text: r.error } : { kind: "ok", text: ok });
    });
  }
  return { pending, note, run, clear: () => setNote(null) };
}

interface SectionProps {
  id: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** Shows the Save row when given. */
  onSave?: () => void;
  dirty?: boolean;
  pending?: boolean;
  note?: { kind: "ok" | "error"; text: string } | null;
  aside?: React.ReactNode;
}

export function Section({ id, title, description, children, onSave, dirty, pending, note, aside }: SectionProps) {
  return (
    <section id={id} className="os-kb-section" aria-labelledby={`${id}-title`}>
      <header className="os-kb-section-head">
        <div className="os-kb-section-title">
          <h2 id={`${id}-title`}>{title}</h2>
          {description && <InfoTip label={`About ${title}`}>{description}</InfoTip>}
        </div>
        {aside}
      </header>
      <div className="os-kb-section-body">{children}</div>
      {onSave && (
        <footer className="os-kb-save" data-dirty={dirty ? "true" : undefined}>
          <span role="status" className="os-kb-note" data-kind={note?.kind}>
            {note?.text ?? (dirty ? "Unsaved changes" : "")}
          </span>
          <button type="button" className="os-button primary" onClick={onSave} disabled={!dirty || pending}>
            {pending ? "Saving…" : "Save"}
          </button>
        </footer>
      )}
    </section>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  children: (id: string) => React.ReactNode;
  wide?: boolean;
}

export function Field({ label, hint, children, wide }: FieldProps) {
  const id = useId();
  return (
    <div className="os-field" data-wide={wide ? "true" : undefined}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <small>{hint}</small>}
    </div>
  );
}

export function TextInput(props: { id?: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <input
      id={props.id}
      className="os-input"
      type={props.type ?? "text"}
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}

export function TextArea(props: { id?: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; mono?: boolean }) {
  return (
    <textarea
      id={props.id}
      className="os-textarea"
      data-mono={props.mono ? "true" : undefined}
      rows={props.rows ?? 4}
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}

export function Select(props: { id?: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <span className="os-select">
      <select id={props.id} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        {props.options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </span>
  );
}

export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      className="os-switch"
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
    >
      <span className="os-switch-knob" />
    </button>
  );
}

/** A repeatable list item with a quiet remove link. */
export function RepeatItem({ children, onRemove, removeLabel }: { children: React.ReactNode; onRemove: () => void; removeLabel: string }) {
  return (
    <li className="os-kb-item">
      {children}
      <div className="os-kb-item-foot">
        <button type="button" className="os-link quiet" onClick={onRemove}>
          {removeLabel}
        </button>
      </div>
    </li>
  );
}
