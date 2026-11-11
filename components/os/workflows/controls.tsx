"use client";

// Small inspector controls: segmented choice, labelled group, the "Saves to"
// field picker with the sync glyph, the lead magnet picker.

import { useState } from "react";
import { fieldLabel, syncTitle, type BuilderContext } from "@/components/os/workflows/context";
import { parseDuration, formatMinutes } from "@/components/os/workflows/forms";
import { WfIcon } from "@/components/os/workflows/icons";
import { MenuButton, SegmentedSwitch, Select } from "@claudepreneur/brand/react";
import { InfoTip } from "@/components/os/ui";

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return <SegmentedSwitch className="wf-seg-full" label={label} value={value} options={options} onChange={(v) => v !== value && onChange(v)} />;
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
      <Select
        fieldClassName="wf-select"
        aria-label={label}
        placeholder="Pick a field"
        value={value}
        onChange={onChange}
        options={[...(!known && value ? [{ value, label: value }] : []), ...ctx.fields.map((f) => ({ value: f.key, label: f.label }))]}
      />
      <SyncGlyph ctx={ctx} k={value} />
      {!known && value ? (
        <span className="wf-warn-dot" role="img" title={`"${value}" isn't a field yet: create it in Settings › Custom fields, or nothing is saved`} aria-label={`"${value}" isn't a field yet`} />
      ) : null}
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

/** A dashed "+ Label" that opens a menu of what can be added. */
export function AddSelect({ label, options, onPick }: { label: string; options: { value: string; label: string }[]; onPick: (v: string) => void }) {
  return (
    <MenuButton
      className="wf-add"
      variant="text"
      caret={false}
      align="start"
      icon={<WfIcon name="plus" size={11} />}
      label={label}
      aria-label={`Add ${label.toLowerCase()}`}
      items={options.map((o) => ({ label: o.label, onSelect: () => onPick(o.value) }))}
    />
  );
}

export function ResourceSelect({ ctx, value, onChange, label = "Lead magnet", allowNone }: { ctx: Pick<BuilderContext, "resources">; value: string | undefined; onChange: (slug: string | undefined) => void; label?: string; allowNone?: string }) {
  return (
    <span className="wf-field-row">
      <WfIcon name="doc" size={13} className="wf-ghost-icon" />
      <Select
        fieldClassName="wf-select"
        aria-label={label}
        value={value ?? ""}
        onChange={(v) => onChange(v || undefined)}
        options={[
          { value: "", label: allowNone ?? "Pick a lead magnet" },
          ...(value && !ctx.resources.some((r) => r.slug === value) ? [{ value, label: value }] : []),
          ...ctx.resources.map((r) => ({ value: r.slug, label: r.name })),
        ]}
      />
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
