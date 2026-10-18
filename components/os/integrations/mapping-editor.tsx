"use client";

import { useEffect, useState, useTransition } from "react";
import { loadProviderFields, saveMapping, type IntegrationActionResult } from "@/app/(os)/os/integrations/actions";
import type { ContactStage } from "@/app/generated/prisma/enums";
import { stageLabels, stageOrder } from "@/lib/os/labels";
import { QUALIFICATION_FIELDS, type FieldMapping, type QualificationKey, type SyncProviderId } from "@/lib/os/integrations/mapping";
import type { ProviderFields } from "@/lib/os/integrations/provider";

interface Props {
  provider: SyncProviderId;
  initial: FieldMapping;
  onSaved: (r: IntegrationActionResult) => void;
}

function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" className="os-switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="os-switch-knob" />
    </button>
  );
}

interface FieldSelectProps {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  label: string;
  fields: ProviderFields | null;
  fieldsError: string | null;
  provider: SyncProviderId;
}

/** A provider custom field picker; a text box when the list couldn't load. */
function FieldSelect({ value, onChange, label, fields, fieldsError, provider }: FieldSelectProps) {
  const name = provider === "kit" ? "Kit" : "GoHighLevel";
  if (!fields) {
    return (
      <input
        className="os-input"
        aria-label={`${label}: ${name} field`}
        placeholder={fieldsError ? (provider === "kit" ? "custom field key" : "field id or contact.key") : "Loading fields…"}
        disabled={!fieldsError}
        value={value ?? ""}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value.trim() || null)}
      />
    );
  }
  const known = fields.customFields.some((f) => f.ref === value);
  return (
    <label className="os-select">
      <span className="sr-only">{`${label}: ${name} field`}</span>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Don&apos;t send</option>
        {fields.customFields.map((f) => (
          <option key={f.ref} value={f.ref}>
            {f.label}
          </option>
        ))}
        {value && !known && <option value={value}>{value} (not found)</option>}
      </select>
    </label>
  );
}

export default function MappingEditor({ provider, initial, onSaved }: Props) {
  const [m, setM] = useState<FieldMapping>(initial);
  const [fields, setFields] = useState<ProviderFields | null>(null);
  const [fieldsError, setFieldsError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [dirty, setDirty] = useState(false);
  const name = provider === "kit" ? "Kit" : "GoHighLevel";

  useEffect(() => {
    let live = true;
    void loadProviderFields(provider).then((r) => {
      if (!live) return;
      if (r.fields) setFields(r.fields);
      else setFieldsError(r.error ?? `Couldn't read ${name}'s fields.`);
    });
    return () => {
      live = false;
    };
  }, [provider, name]);

  function patch(p: Partial<FieldMapping>) {
    setM((cur) => ({ ...cur, ...p }));
    setDirty(true);
  }

  const ctx = { fields, fieldsError, provider };
  const setQual = (key: QualificationKey, v: string | null) => patch({ qualification: { ...m.qualification, [key]: v } });
  const pipeline = fields?.pipelines.find((p) => p.id === m.pipelineId) ?? null;

  return (
    <form
      className="os-int-mapping"
      onSubmit={(e) => {
        e.preventDefault();
        startSaving(async () => {
          const r = await saveMapping(provider, m);
          if (!r.error) setDirty(false);
          onSaved(r);
        });
      }}
    >
      <div className="os-int-row">
        <div className="os-int-row-main">
          <strong>Who</strong>
          <span>Personal DMs stay out unless you pick everyone.</span>
        </div>
        <div className="os-segmented" role="group" aria-label="Who to send">
          <button type="button" aria-pressed={m.scope === "sales"} onClick={() => patch({ scope: "sales" })}>
            Sales contacts
          </button>
          <button type="button" aria-pressed={m.scope === "all"} onClick={() => patch({ scope: "all" })}>
            Everyone
          </button>
        </div>
      </div>

      {fieldsError && <p className="os-int-hint">{fieldsError} Type the field reference instead.</p>}

      <table className="os-int-map">
        <caption className="sr-only">Field mapping</caption>
        <thead>
          <tr>
            <th scope="col">DM OS</th>
            <th scope="col">{name}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">
              First name<small>First word of their Instagram name</small>
            </th>
            <td>
              <span className="os-int-native">First name</span>
              <Switch checked={m.firstName} onChange={(v) => patch({ firstName: v })} label="Send first name" />
            </td>
          </tr>
          <tr>
            <th scope="row">
              Email<small>{provider === "kit" ? "Kit needs it: no email, no subscriber" : "Once they give it in a DM"}</small>
            </th>
            <td>
              <span className="os-int-native">Email</span>
              <Switch checked={provider === "kit" ? true : m.email} disabled={provider === "kit"} onChange={(v) => patch({ email: v })} label="Send email" />
            </td>
          </tr>
          <tr>
            <th scope="row">
              Tags<small>Removed here, removed there</small>
            </th>
            <td>
              <input
                className="os-input os-int-prefix"
                aria-label="Tag prefix"
                placeholder="prefix, e.g. ig-"
                value={m.tagPrefix}
                spellCheck={false}
                disabled={!m.tags}
                onChange={(e) => patch({ tagPrefix: e.target.value })}
              />
              <Switch checked={m.tags} onChange={(v) => patch({ tags: v })} label="Send tags" />
            </td>
          </tr>
          <tr>
            <th scope="row">Instagram handle</th>
            <td>
              <FieldSelect {...ctx} label="Instagram handle" value={m.igHandle} onChange={(v) => patch({ igHandle: v })} />
            </td>
          </tr>
          <tr>
            <th scope="row">
              Stage<small>New, Qualified, Call booked…</small>
            </th>
            <td>
              <FieldSelect {...ctx} label="Stage" value={m.stage} onChange={(v) => patch({ stage: v })} />
            </td>
          </tr>
          <tr>
            <th scope="row">
              Type<small>Sales, Personal or Unsorted</small>
            </th>
            <td>
              <FieldSelect {...ctx} label="Type" value={m.kind} onChange={(v) => patch({ kind: v })} />
            </td>
          </tr>
        </tbody>
        <tbody>
          <tr className="os-int-map-group">
            <th scope="colgroup" colSpan={2}>
              J&apos;s qualification answers<small>What J has heard them say, in their words. Filled as the conversation goes.</small>
            </th>
          </tr>
          {QUALIFICATION_FIELDS.map((f) => (
            <tr key={f.key}>
              <th scope="row">{f.label}</th>
              <td>
                <FieldSelect {...ctx} label={f.label} value={m.qualification[f.key]} onChange={(v) => setQual(f.key, v)} />
              </td>
            </tr>
          ))}
        </tbody>
        {provider === "ghl" && (
          <tbody>
            <tr className="os-int-map-group">
              <th scope="colgroup" colSpan={2}>
                Pipeline<small>Optional. Moves an opportunity to the stage you pick for each DM OS stage.</small>
              </th>
            </tr>
            <tr>
              <th scope="row">Pipeline</th>
              <td>
                {fields && fields.pipelines.length ? (
                  <label className="os-select">
                    <span className="sr-only">Pipeline</span>
                    <select value={m.pipelineId ?? ""} onChange={(e) => patch({ pipelineId: e.target.value || null, stageMap: {} })}>
                      <option value="">No pipeline</option>
                      {fields.pipelines.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <span className="os-int-native">{fields ? "No pipelines (or no opportunities scope)" : "…"}</span>
                )}
              </td>
            </tr>
            {pipeline &&
              stageOrder.map((s: ContactStage) => (
                <tr key={s}>
                  <th scope="row">{stageLabels[s]}</th>
                  <td>
                    <label className="os-select">
                      <span className="sr-only">{`${stageLabels[s]}: pipeline stage`}</span>
                      <select value={m.stageMap?.[s] ?? ""} onChange={(e) => patch({ stageMap: { ...m.stageMap, [s]: e.target.value || null } })}>
                        <option value="">Leave as is</option>
                        {pipeline.stages.map((st) => (
                          <option key={st.id} value={st.id}>
                            {st.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </td>
                </tr>
              ))}
          </tbody>
        )}
      </table>

      <div className="os-int-save">
        <span>{dirty ? "Unsaved changes" : ""}</span>
        <button className="os-button primary" disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save mapping"}
        </button>
      </div>
    </form>
  );
}
