"use client";

// Settings › Fields (Fields canvas): the built-in fields every contact has
// (Instagram handle, plus the built-in rows: name, email), then the custom
// fields. Each custom field has a type, the setters that fill it (ticked in
// each setter's Knowledge base), a Kit field and a GoHighLevel field.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addField, editField, removeField } from "@/app/(os)/os/settings/actions";
import { InfoTip, SetterMark } from "@/components/os/ui";
import { FIELD_TYPES, fieldTypeLabel, type CustomFieldType, type CustomFieldView } from "@/lib/os/fields/types";

interface Props {
  fields: CustomFieldView[];
  setters: { id: string; name: string }[];
  canManage: boolean;
}

type Editing = { id: string | "new"; focus: "label" | "ghl" | "kit" } | null;

export default function FieldsPanel({ fields: initial, setters, canManage }: Props) {
  const router = useRouter();
  const [fields, setFields] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setFields(initial);
  }
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState<string | null>(null);

  const editor = (f: CustomFieldView | null) => (
    <FieldEditor
      key={f?.id ?? "new"}
      field={f}
      focus={editing?.focus ?? "label"}
      onCancel={() => {
        setEditing(null);
        setError(null);
      }}
      onSaved={(saved) => {
        setFields((list) => (f ? list.map((x) => (x.id === saved.id ? saved : x)) : [...list, saved]));
        setEditing(null);
        setError(null);
        router.refresh();
      }}
      onDeleted={() => {
        if (f) setFields((list) => list.filter((x) => x.id !== f.id));
        setEditing(null);
        router.refresh();
      }}
      onError={setError}
    />
  );

  const builtIns = fields.filter((f) => f.builtIn);
  const custom = fields.filter((f) => !f.builtIn);

  return (
    <div className="os-cf">
      <section className="os-set-section" aria-labelledby="os-fd-built">
        <header className="os-set-section-head">
          <h2 id="os-fd-built">Built in</h2>
          <p>Every contact has these. They can&apos;t be renamed or deleted.</p>
        </header>
        <ul className="os-fd-builtin">
          <li>
            <strong>Instagram handle</strong>
            <small>From Instagram. Tied to their Instagram ID, so a changed handle stays the same person.</small>
            <span className="os-fd-chips">
              <span className="os-fd-chip">Handle</span>
              <span className="os-fd-chip">Unique key</span>
            </span>
          </li>
          {!builtIns.length ? (
            <>
              <li>
                <strong>Name</strong>
                <small>From their Instagram profile</small>
                <span className="os-fd-chips">
                  <span className="os-fd-chip">Text</span>
                </span>
              </li>
              <li>
                <strong>Email</strong>
                <small>Captured in the DM or from a lead magnet</small>
                <span className="os-fd-chips">
                  <span className="os-fd-chip">Email</span>
                </span>
              </li>
            </>
          ) : null}
          {builtIns.map((f) =>
            editing?.id === f.id ? (
              <li key={f.id}>{editor(f)}</li>
            ) : (
              <li key={f.id}>
                <strong>{f.label}</strong>
                <small>{builtInHow(f.key)}</small>
                <span className="os-fd-chips">
                  <span className="os-fd-chip">{fieldTypeLabel(f.type)}</span>
                  {f.kitField ? <span className="os-fd-chip">Synced to Kit</span> : null}
                  {canManage ? (
                    <button type="button" className="os-cf-more" aria-label={`Kit and GoHighLevel fields for ${f.label}`} onClick={() => setEditing({ id: f.id, focus: "kit" })}>
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" />
                      </svg>
                    </button>
                  ) : null}
                </span>
              </li>
            )
          )}
        </ul>
      </section>

      <div className="os-cf-head">
        <h2>Custom fields</h2>
        <span className="os-cf-sub">Yours to shape. J fills the ones it can from the conversation.</span>
        <InfoTip label="About custom fields">Setters tick which fields they fill in their Knowledge base. Values sync to the mapped Kit and GoHighLevel fields.</InfoTip>
        <span className="os-cf-grow" />
        {canManage ? (
          <button type="button" className="os-cf-btn primary" onClick={() => setEditing({ id: "new", focus: "label" })} disabled={editing?.id === "new"}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 3.5v9M3.5 8h9" />
            </svg>
            New field
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="os-cf-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="os-cf-wrap">
        <table className="os-cf-table">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Type</th>
              <th scope="col">Filled by</th>
              <th scope="col">Kit</th>
              <th scope="col">GoHighLevel</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {custom.map((f) =>
              editing?.id === f.id ? (
                <tr key={f.id} className="os-cf-editing">
                  <td colSpan={6}>{editor(f)}</td>
                </tr>
              ) : (
                <tr key={f.id}>
                  <td data-label="Field">
                    <span className="os-cf-name">
                      <strong>{f.label}</strong>
                    </span>
                  </td>
                  <td className="os-cf-muted" data-label="Type">
                    {fieldTypeLabel(f.type)}
                  </td>
                  <td data-label="Filled by">
                    <span className="os-cf-setters">
                      {setters
                        .filter((s) => f.usedBy.includes(s.id))
                        .map((s) => (
                          <span key={s.id} className="os-cf-setter">
                            <SetterMark name={s.name} title={`${s.name} fills it`} />
                            {s.name}
                          </span>
                        ))}
                      {!f.usedBy.length ? <span className="os-cf-muted">You</span> : null}
                    </span>
                  </td>
                  <td data-label="Kit">
                    <MapButton value={f.kitField} disabled={!canManage} label={`Kit field for ${f.label}`} onClick={() => setEditing({ id: f.id, focus: "kit" })} />
                  </td>
                  <td data-label="GoHighLevel">
                    <MapButton value={f.ghlField} disabled={!canManage} label={`GoHighLevel field for ${f.label}`} onClick={() => setEditing({ id: f.id, focus: "ghl" })} />
                  </td>
                  <td className="os-cf-end">
                    {canManage ? (
                      <button type="button" className="os-cf-more" aria-label={`More actions for ${f.label}`} onClick={() => setEditing({ id: f.id, focus: "label" })}>
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" />
                        </svg>
                      </button>
                    ) : null}
                  </td>
                </tr>
              )
            )}
            {!custom.length && editing?.id !== "new" ? (
              <tr>
                <td colSpan={6} className="os-cf-muted">
                  No custom fields yet.
                </td>
              </tr>
            ) : null}
            {editing?.id === "new" ? (
              <tr className="os-cf-editing">
                <td colSpan={6}>{editor(null)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Where a built-in field's value comes from. */
function builtInHow(key: string): string {
  if (/email/i.test(key)) return "Captured in the DM or from a lead magnet";
  if (/name/i.test(key)) return "From their Instagram profile";
  return "Every contact has it";
}

function MapButton({ value, label, disabled, onClick }: { value: string | null; label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" className="os-cf-map" data-off={value ? undefined : "true"} aria-label={label} title={value ?? "Not synced"} disabled={disabled} onClick={onClick}>
      <span>{value ?? "Not synced"}</span>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
      </svg>
    </button>
  );
}

function FieldEditor({
  field,
  focus,
  onCancel,
  onSaved,
  onDeleted,
  onError,
}: {
  field: CustomFieldView | null;
  focus: "label" | "ghl" | "kit";
  onCancel: () => void;
  onSaved: (f: CustomFieldView) => void;
  onDeleted: () => void;
  onError: (e: string | null) => void;
}) {
  const [label, setLabel] = useState(field?.label ?? "");
  const [type, setType] = useState<CustomFieldType>(field?.type ?? "TEXT");
  const [options, setOptions] = useState((field?.options ?? []).join(", "));
  const [ghl, setGhl] = useState(field?.ghlField ?? "");
  const [kit, setKit] = useState(field?.kitField ?? "");
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const locked = Boolean(field?.builtIn);

  function save() {
    start(async () => {
      const input = { label, type, options: options.split(",").map((o) => o.trim()).filter(Boolean), ghlField: ghl || null, kitField: kit || null };
      const r = field ? await editField(field.id, input) : await addField(input);
      if ("error" in r) onError(r.error);
      else onSaved(r.field);
    });
  }

  function remove() {
    if (!field) return;
    if (!confirm) {
      setConfirm(true);
      return;
    }
    start(async () => {
      const r = await removeField(field.id);
      if ("error" in r) onError(r.error);
      else onDeleted();
    });
  }

  return (
    <form
      className="os-cf-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <label>
        <span>Name</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} disabled={locked} autoFocus={focus === "label" && !locked} maxLength={60} required />
      </label>
      <label>
        <span>Type</span>
        <select value={type} onChange={(e) => setType(e.target.value as CustomFieldType)} disabled={locked}>
          {FIELD_TYPES.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      {type === "SELECT" ? (
        <label className="os-cf-wide">
          <span>Choices</span>
          <input value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Coach, Creator, Agency" />
        </label>
      ) : null}
      <label>
        <span>Kit field</span>
        <input value={kit} onChange={(e) => setKit(e.target.value)} placeholder="business" autoFocus={focus === "kit"} />
      </label>
      <label>
        <span>GoHighLevel field</span>
        <input value={ghl} onChange={(e) => setGhl(e.target.value)} placeholder="contact.company_name" autoFocus={focus === "ghl"} />
      </label>
      <div className="os-cf-form-actions">
        {field && !locked ? (
          <button type="button" className="os-cf-btn danger" onClick={remove} disabled={pending}>
            {confirm ? "Delete for good?" : "Delete"}
          </button>
        ) : null}
        <span className="os-cf-grow" />
        <button type="button" className="os-cf-btn" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        <button type="submit" className="os-cf-btn primary" disabled={pending}>
          {field ? "Save" : "Add"}
        </button>
      </div>
    </form>
  );
}
