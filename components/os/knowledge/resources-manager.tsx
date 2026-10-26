"use client";

// Knowledge bases › Resources (Resources board): free lead magnets with the
// keywords that send them, and the Best episodes J may share, in priority
// order (drag to reorder). Entry paths (keywords that open a setter thread)
// sit folded at the bottom.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useRef, useState, useTransition } from "react";
import { deleteResource, reorderResources, saveResource, type ResourceForm } from "@/app/(os)/os/knowledge/actions";
import { Field, Select, TextArea, TextInput, useSaver } from "@/components/os/knowledge/fields";
import { KbIcon } from "@/components/os/knowledge/icons";
import { InfoTip } from "@/components/os/ui";
import type { ResourceView } from "@/lib/os/knowledge";
import { hostLabel, moveId, shortLink } from "@/lib/os/setter/knowledge/resources-view";

const EMPTY_MAGNET: ResourceForm = { name: "", kind: "resource", link: "", keyword: "", status: "ACTIVE", description: "" };

function toForm(r: ResourceView): ResourceForm {
  return { id: r.id, name: r.name, kind: r.kind, link: r.link ?? "", keyword: r.keyword ?? "", status: r.status, description: r.description, when: r.when };
}

export default function ResourcesManager({ resources }: { resources: ResourceView[] }) {
  const magnets = resources.filter((r) => r.kind === "resource");
  const episodes = resources.filter((r) => r.kind === "episode");
  const entries = resources.filter((r) => r.kind === "setter");
  return (
    <div className="kb-res">
      <LeadMagnets rows={magnets} />
      <Episodes rows={episodes} />
      {entries.length > 0 && <EntryPaths rows={entries} />}
    </div>
  );
}

// ---------------------------------------------------------------- lead magnets
function LeadMagnets({ rows }: { rows: ResourceView[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section aria-labelledby="kb-lm" className="kb-res-sec">
      <div className="kb-sec-h">
        <h2 id="kb-lm">Lead magnets</h2>
        <span className="kb-quiet">{rows.length} · all free</span>
        <InfoTip label="About lead magnets">What a setter may hand over. Each setter switches them on in Setup › Lead magnets. Keywords come from your campaigns.</InfoTip>
        <div className="kb-grow" />
        <button type="button" className="kb-btn kb-btn-p" onClick={() => setOpen(open === "new" ? null : "new")} aria-expanded={open === "new"}>
          Add lead magnet
        </button>
      </div>
      {open === "new" && <ResourceEditor initial={EMPTY_MAGNET} onDone={() => setOpen(null)} />}
      <div className="kb-tblwrap">
        <table className="kb-tbl">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Link</th>
              <th scope="col">Keywords</th>
              <th scope="col">Used by</th>
              <th scope="col" className="kb-num">
                Sent
              </th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr>
                  <td>
                    <span className="kb-name">
                      <span className="kb-ico">
                        <KbIcon name="gift" />
                      </span>
                      <span>{r.name}</span>
                      {r.status !== "ACTIVE" && <span className="kb-tag">{r.status === "TEST" ? "Test" : "Draft"}</span>}
                    </span>
                  </td>
                  <td>
                    {r.link ? (
                      <a className="kb-link" href={r.link} target="_blank" rel="noreferrer">
                        {shortLink(r.link)}
                      </a>
                    ) : (
                      <span className="kb-quiet">No link</span>
                    )}
                  </td>
                  <td>
                    <span className="kb-kws">
                      {r.keywords.map((k) => (
                        <Link key={k.word} className="kb-kw" href={k.automationId ? `/os/automations/${k.automationId}` : "/os/automations"}>
                          {k.word}
                        </Link>
                      ))}
                      {!r.keywords.length && <span className="kb-quiet">—</span>}
                    </span>
                  </td>
                  <td>
                    <span className="kb-avs">
                      {r.usedBy.map((s) => (
                        <span key={s.id} className="kb-av" title={s.name}>
                          {s.name.trim().charAt(0).toUpperCase()}
                        </span>
                      ))}
                      {r.broadcasts.map((b) => (
                        <Link key={b.key} href={`/os/automations/broadcasts/${b.key}`} className="kb-quiet" title={`Broadcast: ${b.name}`}>
                          {b.name}
                        </Link>
                      ))}
                      {!r.usedBy.length && !r.broadcasts.length && <span className="kb-quiet">—</span>}
                    </span>
                  </td>
                  <td className="kb-num">{r.sent}</td>
                  <td className="kb-act">
                    <button type="button" className="kb-icon-btn" aria-label={`More for ${r.name}`} aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                      <KbIcon name="more" />
                    </button>
                  </td>
                </tr>
                {open === r.id && (
                  <tr className="kb-tbl-edit">
                    <td colSpan={6}>
                      <ResourceEditor initial={toForm(r)} slug={r.slug} onDone={() => setOpen(null)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="kb-quiet">
                  No lead magnets yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- best episodes
function Episodes({ rows }: { rows: ResourceView[] }) {
  const router = useRouter();
  const [order, setOrder] = useState(() => rows.map((r) => r.id));
  const [dragging, setDragging] = useState<string | null>(null);
  const before = useRef<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const add = useSaver();
  // New rows from the server land at the end of the local order.
  const ids = [...order.filter((id) => rows.some((r) => r.id === id)), ...rows.filter((r) => !order.includes(r.id)).map((r) => r.id)];
  const byId = new Map(rows.map((r) => [r.id, r]));

  const commit = (next: string[], prev: string[] = ids) => {
    setOrder(next);
    setError(null);
    start(async () => {
      const r = await reorderResources(next);
      if (r.error) {
        setOrder(prev);
        setError(r.error);
      }
    });
  };

  const addVideo = () => {
    const link = url.trim();
    if (!/^https?:\/\//i.test(link)) {
      setError("Paste a link that starts with https://");
      return;
    }
    add.run(async () => {
      const r = await saveResource({ name: "New episode", kind: "episode", link, keyword: "", status: "ACTIVE", description: "", when: "" });
      if (!r.error) {
        setUrl("");
        if (r.id) setOpen(r.id);
        router.refresh();
      }
      return r;
    }, "Added");
  };

  return (
    <section aria-labelledby="kb-ep" className="kb-res-sec">
      <div className="kb-sec-h">
        <h2 id="kb-ep">Best episodes</h2>
        <span className="kb-quiet">{rows.length} · J shares the highest one that fits</span>
        <div className="kb-grow" />
        <label className="sr-only" htmlFor="kb-yt">
          YouTube link
        </label>
        <input
          id="kb-yt"
          type="url"
          className="kb-input kb-yt"
          placeholder="Paste a YouTube link"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addVideo();
          }}
        />
        <button type="button" className="kb-btn" onClick={addVideo} disabled={add.pending || !url.trim()}>
          {add.pending ? "Adding…" : "Add video"}
        </button>
      </div>
      {(error || add.note?.kind === "error") && <p className="kb-err">{error ?? add.note?.text}</p>}
      <ol aria-label="Best episodes in priority order" className="kb-eps" data-busy={pending ? "true" : undefined}>
        {ids.map((id, i) => {
          const r = byId.get(id)!;
          return (
            <li
              key={id}
              className="kb-ep"
              data-dragging={dragging === id ? "true" : undefined}
              onDragOver={(e) => {
                if (!dragging || dragging === id) return;
                e.preventDefault();
                setOrder(moveId(ids, dragging, id));
              }}
              onDrop={(e) => e.preventDefault()}
            >
              <div className="kb-ep-row">
                <button
                  type="button"
                  className="kb-grip"
                  draggable
                  aria-label={`Reorder ${r.name}`}
                  aria-keyshortcuts="ArrowUp ArrowDown"
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", id);
                    before.current = ids;
                    setDragging(id);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    if (ids.join() !== before.current.join()) commit(ids, before.current);
                  }}
                  onKeyDown={(e) => {
                    const j = e.key === "ArrowUp" ? i - 1 : e.key === "ArrowDown" ? i + 1 : -1;
                    if (j < 0 || j >= ids.length) return;
                    e.preventDefault();
                    commit(moveId(ids, id, ids[j]));
                  }}
                >
                  <KbIcon name="grip" />
                </button>
                <span className="kb-rank">{i + 1}</span>
                <span className="kb-ico">
                  <KbIcon name="video" />
                </span>
                <span className="kb-ep-main">
                  <span>{r.name}</span>
                  <span className="kb-quiet">{hostLabel(r.link)}</span>
                </span>
                <span className="kb-ep-when">{r.when || <span className="kb-quiet">When to share?</span>}</span>
                {r.link && (
                  <a className="kb-link" href={r.link} target="_blank" rel="noreferrer">
                    {shortLink(r.link)}
                  </a>
                )}
                <button type="button" className="kb-icon-btn" aria-label={`More for ${r.name}`} aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}>
                  <KbIcon name="more" />
                </button>
              </div>
              {open === id && <ResourceEditor initial={toForm(r)} slug={r.slug} onDone={() => setOpen(null)} />}
            </li>
          );
        })}
        {!ids.length && <li className="kb-quiet">No episodes yet. Paste a YouTube link.</li>}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------- entry paths
function EntryPaths({ rows }: { rows: ResourceView[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <details className="kb-res-sec kb-entries" open>
      <summary>
        Entry paths <span className="kb-quiet">{rows.length}</span>
      </summary>
      <ul className="kb-entry-list">
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" className="kb-entry" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
              <span>{r.name}</span>
              {r.keyword && <span className="kb-kw">{r.keyword}</span>}
            </button>
            {open === r.id && <ResourceEditor initial={toForm(r)} slug={r.slug} onDone={() => setOpen(null)} />}
          </li>
        ))}
      </ul>
    </details>
  );
}

// ---------------------------------------------------------------- one resource
function ResourceEditor({ initial, slug, onDone }: { initial: ResourceForm; slug?: string; onDone: () => void }) {
  const router = useRouter();
  const [f, setF] = useState<ResourceForm>(initial);
  const saver = useSaver();
  const del = useSaver();
  const set = (p: Partial<ResourceForm>) => setF({ ...f, ...p });
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const episode = f.kind === "episode";
  return (
    <div className="kb-res-form">
      <div className="os-kb-grid2">
        <Field label="Name">{(id) => <TextInput id={id} value={f.name} onChange={(x) => set({ name: x })} />}</Field>
        <Field label="Link">{(id) => <TextInput id={id} value={f.link} placeholder="https://" onChange={(x) => set({ link: x })} />}</Field>
        {!episode && (
          <Field label="Keyword" hint="Also mapped from campaigns in Automations.">
            {(id) => <TextInput id={id} value={f.keyword} onChange={(x) => set({ keyword: x })} />}
          </Field>
        )}
        <Field label="Status">
          {(id) => (
            <Select
              id={id}
              value={f.status}
              onChange={(x) => set({ status: x as ResourceForm["status"] })}
              options={[
                ["ACTIVE", episode ? "On" : "Active"],
                ["DRAFT", episode ? "Off" : "Draft"],
                ...(episode ? [] : ([["TEST", "Test"]] as [string, string][])),
              ]}
            />
          )}
        </Field>
        {slug && !episode && (
          <Field label="Slug" hint="Fixed: J and old links refer to it.">
            {(id) => <input id={id} className="os-input" value={slug} readOnly />}
          </Field>
        )}
      </div>
      {episode ? (
        <Field label="When to share" hint="In a few words, e.g. Wants to build it themselves." wide>
          {(id) => <TextInput id={id} value={f.when ?? ""} onChange={(x) => set({ when: x })} />}
        </Field>
      ) : (
        <Field label={f.kind === "setter" ? "What J does when someone arrives this way" : "What J should know"} wide>
          {(id) => <TextArea id={id} rows={3} value={f.description} onChange={(x) => set({ description: x })} />}
        </Field>
      )}
      <div className="os-kb-save">
        <span role="status" className="os-kb-note" data-kind={saver.note?.kind ?? del.note?.kind}>
          {saver.note?.text ?? del.note?.text ?? ""}
        </span>
        {f.id && (
          <button
            type="button"
            className="os-button ghost"
            disabled={del.pending}
            onClick={() => {
              if (!window.confirm(`Delete ${f.name}?`)) return;
              del.run(async () => {
                const r = await deleteResource(f.id!);
                if (!r.error) {
                  onDone();
                  router.refresh();
                }
                return r;
              }, "Deleted");
            }}
          >
            Delete
          </button>
        )}
        <button type="button" className="os-button" onClick={onDone}>
          {dirty ? "Cancel" : "Close"}
        </button>
        <button
          type="button"
          className="os-button primary"
          disabled={!dirty || saver.pending || !f.name.trim()}
          onClick={() =>
            saver.run(async () => {
              const r = await saveResource(f);
              if (!r.error) {
                onDone();
                router.refresh();
              }
              return r;
            })
          }
        >
          {saver.pending ? "Saving…" : f.id ? "Save" : "Add"}
        </button>
      </div>
    </div>
  );
}
