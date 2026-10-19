"use client";

// Details tab (ContactsD): fields n/m with who filled each one and inline
// edit, CRM sync state, keywords triggered → resource, lead magnets sent and
// Kit tags. Owner: S3. Hosts without the data (the Inbox) get it on mount.

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { loadDetails, saveFieldValue, syncContactNow, updateContacts } from "@/app/(os)/os/contacts/actions";
import { SetterMark } from "@/components/os/ui";
import type { ContactDetailsData, DetailsSync } from "@/lib/os/contact-panel/details";
import type { ContactPanelData } from "@/lib/os/contact-panel/types";
import { normalizeTag } from "@/lib/os/contacts-filter";
import type { DetailsField } from "@/lib/os/fields/types";
import { shortAgo } from "@/lib/os/labels";

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");
const when = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? "today" : day(iso);
};

function sourceTitle(f: DetailsField, setter: string): string {
  const at = when(f.at);
  switch (f.source) {
    case "j":
      return `Filled by ${setter}${at ? ` · ${at}` : ""}`;
    case "instagram":
      return `From Instagram profile${at ? ` · ${at}` : ""}`;
    case "import":
      return `From Kit opt-in${at ? ` · ${at}` : ""}`;
    case "user":
      return `Set by you${at ? ` · ${at}` : ""}`;
    default:
      return "";
  }
}

export default function DetailsTab({ data, details: initial }: { data: ContactPanelData; details?: ContactDetailsData | null }) {
  const [details, setDetails] = useState<ContactDetailsData | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    if (initial) setDetails(initial);
  }

  useEffect(() => {
    if (initial || details?.contactId === data.contactId) return;
    let live = true;
    loadDetails(data.contactId).then((r) => {
      if (!live) return;
      if ("error" in r) setError(r.error);
      else setDetails(r);
    });
    return () => {
      live = false;
    };
  }, [data.contactId, initial, details?.contactId]);

  if (!details) return <p className="os-cd-loading">{error ?? "Loading…"}</p>;
  return <DetailsBody key={details.contactId} data={data} details={details} onChange={setDetails} />;
}

function DetailsBody({ data, details, onChange }: { data: ContactPanelData; details: ContactDetailsData; onChange: (d: ContactDetailsData) => void }) {
  const setter = details.setterName ?? data.setter?.name ?? "J";
  const [status, setStatus] = useState<string | null>(null);

  return (
    <div className="os-cd">
      <section className="os-cd-sec" aria-labelledby="cd-fields">
        <h2 id="cd-fields">
          Fields<span className="os-cd-n">{details.filled}/{details.fields.length}</span>
          <span className="os-cd-grow" />
          <Link href="/os/settings?tab=fields" className="os-cd-icon" aria-label="Manage fields" title="Manage fields">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
              <circle cx="10" cy="4.5" r="1.5" />
              <circle cx="6" cy="11.5" r="1.5" />
            </svg>
          </Link>
        </h2>
        <div className="os-cd-fields">
          {details.fields.map((f) => (
            <FieldRow
              key={f.fieldId}
              f={f}
              contactId={data.contactId}
              setter={setter}
              onSaved={(value) =>
                onChange({
                  ...details,
                  fields: details.fields.map((x) => (x.fieldId === f.fieldId ? { ...x, value, source: value ? "user" : null, at: new Date().toISOString() } : x)),
                  filled: details.fields.filter((x) => (x.fieldId === f.fieldId ? value : x.value)).length,
                })
              }
              onError={setStatus}
            />
          ))}
        </div>
        <div className="os-cd-sync">
          {details.sync.map((s) => (
            <SyncChip key={s.provider} s={s} contactId={data.contactId} />
          ))}
        </div>
        {status ? (
          <p className="os-cd-status" role="status">
            {status}
          </p>
        ) : null}
      </section>

      {data.keywords.length ? (
        <section className="os-cd-sec" aria-labelledby="cd-kw">
          <h2 id="cd-kw">Keywords</h2>
          <ul className="os-cd-list">
            {data.keywords.map((k, i) => (
              <li key={`${k.word}-${i}`} title={k.title ?? undefined}>
                <span className="os-cd-kw">{k.word}</span>
                {k.resource ? (
                  <>
                    <svg className="os-cd-arrow" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M3 8h10M9.5 4.5 13 8l-3.5 3.5" />
                    </svg>
                    <Link href="/os/knowledge/resources" className="os-cd-res">
                      {k.resource}
                    </Link>
                  </>
                ) : (
                  <span className="os-cd-grow" />
                )}
                <span className="os-cd-date">{day(k.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="os-cd-sec" aria-labelledby="cd-lm">
        <h2 id="cd-lm">
          Lead magnets sent<span className="os-cd-n">{details.leadMagnets.length}</span>
        </h2>
        {details.leadMagnets.length ? (
          <ul className="os-cd-list">
            {details.leadMagnets.map((m) => (
              <li key={m.name} title={m.via === "openreply" ? "Button card via OpenReply" : `Link sent by ${setter}`}>
                <svg className="os-cd-ico" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4 2.5h5.5L12 5v8.5H4zM9.5 2.5V5H12" />
                </svg>
                <span className="os-cd-res os-cd-grow">{m.name}</span>
                {m.via === "openreply" ? (
                  <svg className="os-cd-ico" viewBox="0 0 16 16" aria-label="Button card via OpenReply" role="img">
                    <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
                    <path d="M2.5 9.5h11" />
                  </svg>
                ) : (
                  <SetterMark name={setter} title={`Sent by ${setter}`} />
                )}
                <span className="os-cd-date">{day(m.at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="os-cd-none">None yet</p>
        )}
      </section>

      <KitTags contactId={data.contactId} tags={details.tags} subscribed={details.kitSubscribed} onTags={(tags) => onChange({ ...details, tags })} onError={setStatus} />
    </div>
  );
}

function FieldRow({ f, contactId, setter, onSaved, onError }: { f: DetailsField; contactId: string; setter: string; onSaved: (v: string | null) => void; onError: (e: string | null) => void }) {
  const [value, setValue] = useState(f.value ?? "");
  const [pending, start] = useTransition();
  const id = `cf-${contactId}-${f.key}`;
  const title = sourceTitle(f, setter);

  function save() {
    const next = value.trim();
    if (next === (f.value ?? "")) return;
    start(async () => {
      const r = await saveFieldValue(contactId, f.key, next || null);
      if ("error" in r) {
        onError(r.error);
        setValue(f.value ?? "");
      } else {
        onError(null);
        setValue(r.value ?? "");
        onSaved(r.value);
      }
    });
  }

  return (
    <div className="os-cd-field" data-pending={pending ? "true" : undefined}>
      <label htmlFor={id}>{f.label}</label>
      {f.type === "SELECT" && f.options.length ? (
        <select id={id} value={value} onChange={(e) => setValue(e.target.value)} onBlur={save}>
          <option value="">Empty</option>
          {f.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={f.type === "EMAIL" ? "email" : "text"}
          value={value}
          placeholder="Empty"
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setValue(f.value ?? "");
          }}
        />
      )}
      <span className="os-cd-src">
        {f.value && f.source === "j" ? (
          <SetterMark name={setter} title={title} />
        ) : f.value && title ? (
          <span className="os-cd-dot" title={title} aria-label={title} role="img" />
        ) : null}
      </span>
    </div>
  );
}

function SyncChip({ s, contactId }: { s: DetailsSync; contactId: string }) {
  const [pending, start] = useTransition();
  const [now] = useState(() => Date.now());
  if (s.state === "off") {
    return (
      <span className="os-cd-chip" data-state="off">
        <i />
        <span>{s.name}</span>
        <Link href="/os/settings?tab=integrations">Connect</Link>
      </span>
    );
  }
  return (
    <span className="os-cd-chip" data-state={s.state} title={s.detail ?? undefined}>
      <i />
      <span>{s.name}</span>
      <span className="os-cd-date">{s.state === "synced" ? shortAgo(s.at, now) : s.state === "error" ? "Failed" : "Waiting"}</span>
      <button type="button" aria-label={`Sync ${s.name} now`} title="Sync now" disabled={pending} onClick={() => start(async () => void (await syncContactNow(contactId)))}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M13 8a5 5 0 0 1-8.6 3.5M3 8a5 5 0 0 1 8.6-3.5M11.5 2v2.7H8.8M4.5 14v-2.7h2.7" />
        </svg>
      </button>
    </span>
  );
}

function KitTags({ contactId, tags, subscribed, onTags, onError }: { contactId: string; tags: string[]; subscribed: boolean; onTags: (t: string[]) => void; onError: (e: string | null) => void }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [, start] = useTransition();

  function add() {
    const tag = normalizeTag(draft);
    setAdding(false);
    setDraft("");
    if (!tag || tags.includes(tag)) return;
    const before = tags;
    onTags([...tags, tag]);
    start(async () => {
      const r = await updateContacts([contactId], { type: "addTag", tag });
      if (r.error) {
        onTags(before);
        onError(r.error);
      }
    });
  }

  function remove(tag: string) {
    const before = tags;
    onTags(tags.filter((t) => t !== tag));
    start(async () => {
      const r = await updateContacts([contactId], { type: "removeTag", tag });
      if (r.error) {
        onTags(before);
        onError(r.error);
      }
    });
  }

  return (
    <section className="os-cd-sec" aria-labelledby="cd-kit">
      <h2 id="cd-kit">
        Kit tags
        {subscribed ? <span className="os-cd-sub" title="Subscribed" aria-label="Subscribed" role="img" /> : null}
      </h2>
      <div className="os-cd-tags">
        {tags.map((t) => (
          <span key={t} className="os-cd-tag">
            {t}
            <button type="button" aria-label={`Remove ${t}`} onClick={() => remove(t)}>
              ×
            </button>
          </span>
        ))}
        {adding ? (
          <input
            className="os-cd-tag-input"
            autoFocus
            value={draft}
            aria-label="New tag"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={add}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
              if (e.key === "Escape") {
                setAdding(false);
                setDraft("");
              }
            }}
          />
        ) : (
          <button type="button" className="os-cd-add" aria-label="Add tag" title="Add tag" onClick={() => setAdding(true)}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 3.5v9M3.5 8h9" />
            </svg>
          </button>
        )}
      </div>
    </section>
  );
}
