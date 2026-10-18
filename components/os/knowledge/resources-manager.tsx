"use client";

// The workspace's Resource table (spec item 14): one list for every setter.
// Each knowledge base switches these on or off for J.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteResource, saveResource, type ResourceForm } from "@/app/(os)/os/knowledge/actions";
import { Field, Select, TextArea, TextInput, useSaver } from "@/components/os/knowledge/fields";
import { StatusChip } from "@/components/os/knowledge/setter-editor";
import type { ResourceView } from "@/lib/os/knowledge";

const EMPTY: ResourceForm = { name: "", kind: "resource", link: "", keyword: "", status: "DRAFT", description: "" };

function toForm(r: ResourceView): ResourceForm {
  return { id: r.id, name: r.name, kind: r.kind, link: r.link ?? "", keyword: r.keyword ?? "", status: r.status, description: r.description };
}

export default function ResourcesManager({ resources }: { resources: ResourceView[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const magnets = resources.filter((r) => r.kind === "resource");
  const entries = resources.filter((r) => r.kind === "setter");
  return (
    <div className="os-kb-resources">
      <div className="os-kb-resources-bar">
        <button type="button" className="os-button primary" onClick={() => setOpen(open === "new" ? null : "new")} aria-expanded={open === "new"}>
          New resource
        </button>
      </div>
      {open === "new" && <ResourceEditor initial={EMPTY} onDone={() => setOpen(null)} />}

      <ResourceGroup
        title="Lead magnets"
        help="What J may hand over: videos, guides, workshops. Active ones that a knowledge base switches on are the only links J knows."
        rows={magnets}
        open={open}
        setOpen={setOpen}
      />
      <ResourceGroup
        title="Entry paths"
        help="Keywords that open a setter conversation (a DM word, an OpenReply comment campaign). J uses them to know how someone arrived; it never offers them."
        rows={entries}
        open={open}
        setOpen={setOpen}
      />
    </div>
  );
}

function ResourceGroup(props: { title: string; help: string; rows: ResourceView[]; open: string | null; setOpen: (id: string | null) => void }) {
  return (
    <section className="os-kb-section" aria-label={props.title}>
      <header className="os-kb-section-head">
        <div>
          <h2>{props.title}</h2>
          <p>{props.help}</p>
        </div>
      </header>
      {!props.rows.length && <p className="os-kb-help">None yet.</p>}
      <ul className="os-kb-rows">
        {props.rows.map((r) => (
          <li key={r.id} data-open={props.open === r.id ? "true" : undefined}>
            <button type="button" className="os-kb-row" aria-expanded={props.open === r.id} onClick={() => props.setOpen(props.open === r.id ? null : r.id)}>
              <span className="os-kb-row-main">
                <strong>{r.name}</strong>
                <span className="os-kb-url">{r.link || "No link"}</span>
              </span>
              <span className="os-kb-row-meta">
                {r.keyword && <span className="chip quiet">{r.keyword}</span>}
                <StatusChip status={r.status} />
                {r.kind === "resource" && (
                  <span className="os-kb-count">
                    {r.setterCount} {r.setterCount === 1 ? "setter" : "setters"}
                  </span>
                )}
              </span>
            </button>
            {props.open === r.id && <ResourceEditor initial={toForm(r)} slug={r.slug} onDone={() => props.setOpen(null)} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ResourceEditor({ initial, slug, onDone }: { initial: ResourceForm; slug?: string; onDone: () => void }) {
  const router = useRouter();
  const [f, setF] = useState<ResourceForm>(initial);
  const saver = useSaver();
  const del = useSaver();
  const set = (p: Partial<ResourceForm>) => setF({ ...f, ...p });
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  return (
    <div className="os-kb-resource-form">
      <div className="os-kb-grid2">
        <Field label="Name">{(id) => <TextInput id={id} value={f.name} onChange={(x) => set({ name: x })} />}</Field>
        <Field label="Status" hint="J only offers active ones.">
          {(id) => (
            <Select
              id={id}
              value={f.status}
              onChange={(x) => set({ status: x as ResourceForm["status"] })}
              options={[
                ["ACTIVE", "Active"],
                ["TEST", "Test"],
                ["DRAFT", "Draft"],
              ]}
            />
          )}
        </Field>
        <Field label="Link">{(id) => <TextInput id={id} value={f.link} placeholder="https://" onChange={(x) => set({ link: x })} />}</Field>
        <Field label="Keyword" hint="The comment or DM word that triggers it (lives in OpenReply or Zernio, never both).">
          {(id) => <TextInput id={id} value={f.keyword} onChange={(x) => set({ keyword: x })} />}
        </Field>
        <Field label="Type">
          {(id) => (
            <Select
              id={id}
              value={f.kind}
              onChange={(x) => set({ kind: x as ResourceForm["kind"] })}
              options={[
                ["resource", "Lead magnet"],
                ["setter", "Entry path"],
              ]}
            />
          )}
        </Field>
        {slug && (
          <Field label="Slug" hint="Fixed: J and old links refer to it.">
            {(id) => <input id={id} className="os-input" value={slug} readOnly />}
          </Field>
        )}
      </div>
      <Field label="What J should know" hint="What it is and who it helps. For an entry path: what to do when someone arrives this way." wide>
        {(id) => <TextArea id={id} rows={4} value={f.description} onChange={(x) => set({ description: x })} />}
      </Field>
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
              if (!window.confirm(`Delete ${f.name}? Every setter stops offering it.`)) return;
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
