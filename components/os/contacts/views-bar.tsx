"use client";

// Saved views (dm-crm issue 018): a pill per view (the default marked), an
// "Edited" marker while the columns, filters or sort differ from the saved
// view, Save (for everyone, overwrites the open view), Save as, Reset, and a
// menu with Set default / Rename / Delete (never the default).

import { useState, useTransition } from "react";
import { deleteContactView, renameContactView, saveContactView, saveContactViewAs, setDefaultContactView } from "@/app/(os)/os/contacts/actions";
import type { ViewState } from "@/lib/os/contacts-view";
import type { SavedViewRecord } from "@/lib/os/saved-views";

interface Props {
  views: SavedViewRecord[];
  currentId: string | null;
  state: ViewState;
  edited: boolean;
  onPick: (v: SavedViewRecord) => void;
  onReset: () => void;
  onViews: (views: SavedViewRecord[], savedId?: string) => void;
  onStatus: (s: { text: string; error?: boolean } | null) => void;
}

export default function ViewsBar(p: Props) {
  const [pending, start] = useTransition();
  const [naming, setNaming] = useState<"new" | "rename" | null>(null);
  const [name, setName] = useState("");
  const current = p.views.find((v) => v.id === p.currentId) ?? null;

  function run(fn: () => Promise<{ views: SavedViewRecord[]; savedId?: string } | { error: string }>, done: string) {
    start(async () => {
      const r = await fn().catch(() => ({ error: "That didn't save. Try again." }));
      if ("error" in r) return p.onStatus({ text: r.error, error: true });
      p.onViews(r.views, "savedId" in r ? r.savedId : undefined);
      p.onStatus({ text: done });
      setNaming(null);
      setName("");
    });
  }

  function submitName(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    if (naming === "rename" && current) run(() => renameContactView(current.id, n), `Renamed to ${n}.`);
    else run(() => saveContactViewAs(n, p.state), `Saved “${n}”.`);
  }

  return (
    <div className="os-cv-views" role="group" aria-label="Saved views">
      <div className="os-cv-view-pills" role="tablist" aria-label="Views">
        {p.views.map((v) => (
          <button key={v.id} type="button" role="tab" aria-selected={v.id === p.currentId} className="os-cv-view" onClick={() => p.onPick(v)}>
            {v.name}
            {v.isDefault ? <span className="os-cv-default"> · default</span> : null}
          </button>
        ))}
      </div>
      {/* Right by the pills, so it reads as "this view's" options. */}
      {current && !naming ? (
        <span className="os-select os-cv-more">
          <select
            aria-label={`More for ${current.name}`}
            value=""
            disabled={pending}
            onChange={(e) => {
              const v = e.target.value;
              e.target.value = "";
              if (v === "default") run(() => setDefaultContactView(current.id), `${current.name} is the default.`);
              if (v === "rename") {
                setNaming("rename");
                setName(current.name);
              }
              if (v === "delete" && window.confirm(`Delete the view “${current.name}” for everyone?`)) run(() => deleteContactView(current.id), `Deleted “${current.name}”.`);
            }}
          >
            <option value="">View options</option>
            <option value="default" disabled={current.isDefault}>
              Make default
            </option>
            <option value="rename">Rename</option>
            <option value="delete" disabled={current.isDefault}>
              {current.isDefault ? "Delete (not the default)" : "Delete"}
            </option>
          </select>
        </span>
      ) : null}
      {p.edited ? <span className="os-cv-edited">Edited</span> : null}
      <span className="os-cx-grow" />
      {naming ? (
        <form className="os-cv-name" onSubmit={submitName}>
          <input className="os-input" autoFocus aria-label="View name" placeholder="View name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="os-button primary" disabled={pending || !name.trim()}>
            {naming === "rename" ? "Rename" : "Save"}
          </button>
          <button type="button" className="os-button ghost" onClick={() => setNaming(null)}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          {p.edited && current ? (
            <>
              <button type="button" className="os-button ghost" onClick={p.onReset}>
                Reset
              </button>
              <button type="button" className="os-button primary" disabled={pending} onClick={() => run(() => saveContactView(current.id, p.state), `Saved “${current.name}” for everyone.`)}>
                Save for everyone
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="os-button ghost"
            onClick={() => {
              setNaming("new");
              setName("");
            }}
          >
            + Save view
          </button>
        </>
      )}
    </div>
  );
}
