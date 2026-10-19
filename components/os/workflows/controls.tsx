"use client";

// Small inspector controls: segmented choice, labelled group, the "Saves to"
// field picker with the sync glyph, the lead magnet picker.

import { useState } from "react";
import { fieldLabel, syncTitle, type BuilderContext } from "@/components/os/workflows/context";
import { parseDuration, formatMinutes } from "@/components/os/workflows/forms";
import { WfIcon } from "@/components/os/workflows/icons";
import { InfoTip } from "@/components/os/ui";

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="wf-seg wf-seg-full" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => value !== o.value && onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Group({ label, tip, children, aside }: { label: string; tip?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="wf-group">
      <span className="wf-lab">
        {label}
        {tip ? <InfoTip label={`About ${label}`}>{tip}</InfoTip> : null}
        {aside ? <span className="wf-grow" /> : null}
        {aside}
      </span>
      {children}
    </div>
  );
}

function SyncGlyph({ ctx, k }: { ctx: Pick<BuilderContext, "fields">; k: string }) {
  const t = syncTitle(ctx.fields.find((f) => f.key === k));
  return t ? (
    <span className="wf-sync" title={t} aria-label={t} role="img">
      <WfIcon name="sync" size={11} />
    </span>
  ) : null;
}

/** One field ("Saves to" on Ask, "Wait until" on Wait). */
export function FieldSelect({ ctx, value, onChange, label = "Field" }: { ctx: Pick<BuilderContext, "fields">; value: string; onChange: (k: string) => void; label?: string }) {
  const known = ctx.fields.some((f) => f.key === value);
  return (
    <span className="wf-field-row">
      <select className="os-input wf-select" value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
        {!value ? <option value="">Pick a field</option> : null}
        {!known && value ? <option value={value}>{value}</option> : null}
        {ctx.fields.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </select>
      <SyncGlyph ctx={ctx} k={value} />
    </span>
  );
}

/** Several fields as chips (Setter › Saves to). */
export function FieldChips({ ctx, value, onChange }: { ctx: Pick<BuilderContext, "fields">; value: string[]; onChange: (v: string[]) => void }) {
  const left = ctx.fields.filter((f) => !value.includes(f.key));
  return (
    <div className="wf-chips">
      {value.map((k) => (
        <span key={k} className="wf-chip">
          {fieldLabel(ctx, k)}
          <SyncGlyph ctx={ctx} k={k} />
          <button type="button" className="wf-chip-x" aria-label={`Remove ${fieldLabel(ctx, k)}`} onClick={() => onChange(value.filter((x) => x !== k))}>
            <WfIcon name="close" size={10} />
          </button>
        </span>
      ))}
      {left.length ? (
        <AddSelect label="Field" options={left.map((f) => ({ value: f.key, label: f.label }))} onPick={(k) => onChange([...value, k])} />
      ) : null}
    </div>
  );
}

/** A dashed "+ Label" that is really a select. */
export function AddSelect({ label, options, onPick }: { label: string; options: { value: string; label: string }[]; onPick: (v: string) => void }) {
  return (
    <label className="wf-add">
      <WfIcon name="plus" size={11} />
      {label}
      <select
        value=""
        aria-label={`Add ${label.toLowerCase()}`}
        onChange={(e) => {
          if (e.target.value) onPick(e.target.value);
        }}
      >
        <option value="">{label}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ResourceSelect({ ctx, value, onChange, label = "Lead magnet", allowNone }: { ctx: Pick<BuilderContext, "resources">; value: string | undefined; onChange: (slug: string | undefined) => void; label?: string; allowNone?: string }) {
  return (
    <span className="wf-field-row">
      <WfIcon name="doc" size={13} className="wf-ghost-icon" />
      <select className="os-input wf-select" value={value ?? ""} aria-label={label} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">{allowNone ?? "Pick a lead magnet"}</option>
        {value && !ctx.resources.some((r) => r.slug === value) ? <option value={value}>{value}</option> : null}
        {ctx.resources.map((r) => (
          <option key={r.slug} value={r.slug}>
            {r.name}
          </option>
        ))}
      </select>
    </span>
  );
}

/** "2h", "1d", "30m": free text, kept while typing, parsed on blur. */
export function DurationInput({ value, onChange, label, placeholder = "1d" }: { value: number | undefined; onChange: (min: number | undefined) => void; label: string; placeholder?: string }) {
  const [text, setText] = useState(formatMinutes(value));
  const [bad, setBad] = useState(false);
  return (
    <input
      className="os-input wf-dur"
      value={text}
      placeholder={placeholder}
      aria-label={label}
      aria-invalid={bad || undefined}
      onChange={(e) => {
        setText(e.target.value);
        const m = parseDuration(e.target.value);
        setBad(Boolean(e.target.value.trim()) && m === null);
        if (m !== null) onChange(m);
        else if (!e.target.value.trim()) onChange(undefined);
      }}
      onBlur={() => {
        const m = parseDuration(text);
        if (m !== null) setText(formatMinutes(m));
      }}
    />
  );
}
