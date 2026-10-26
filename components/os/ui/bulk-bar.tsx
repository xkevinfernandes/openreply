"use client";

// The one bulk bar (Inbox, Contacts, Pipeline): same order and words
// everywhere. [select all] N selected · Clear, then Tag… · Won… · Lost ·
// Archive / Restore · the screen's extras. Tag… is one menu: add a tag (or a
// new one), or take off a tag the selection has. Won always goes through the
// Won picker (the host opens it). The host shows the toast.

import { useEffect, useRef, useState } from "react";
import { bulkTagMenu } from "@/lib/os/bulk-tags";
import { normalizeTag } from "@/lib/os/contacts-filter";

export interface BulkBarProps {
  count: number;
  /** The select-all box: ticked when every shown row is picked, a dash when some are. */
  all?: { checked: boolean; onChange: (on: boolean) => void };
  /** Every tag in the workspace. */
  tags: string[];
  /** Tags on each selected contact (one list per contact). */
  selectedTags: string[][];
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onWon: () => void;
  onLost: () => void;
  /** The Archived filter is on: Restore instead of Archive. */
  archived: boolean;
  onArchive: (archived: boolean) => void;
  onClear: () => void;
  pending?: boolean;
  /** Screen-only actions, last (Inbox: Mark spam; Pipeline: Move…). */
  extra?: React.ReactNode;
  className?: string;
}

const NEW = "__new";

export default function BulkBar(p: BulkBarProps) {
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState("");
  const box = useRef<HTMLInputElement>(null);
  const some = p.count > 0 && !p.all?.checked;
  useEffect(() => {
    if (box.current) box.current.indeterminate = some;
  }, [some]);
  if (!p.count) return null;
  const menu = bulkTagMenu(p.tags, p.selectedTags);

  function onTag(v: string) {
    if (!v) return;
    if (v === NEW) return setNaming(true);
    const [op, ...rest] = v.split(":");
    const name = rest.join(":");
    if (op === "remove") p.onRemoveTag(name);
    else p.onAddTag(name);
  }

  function addNew(e: React.FormEvent) {
    e.preventDefault();
    const t = normalizeTag(draft);
    if (!t) return;
    p.onAddTag(t);
    setDraft("");
    setNaming(false);
  }

  return (
    <div className={`os-bulk${p.className ? ` ${p.className}` : ""}`} role="region" aria-label="Bulk actions" aria-busy={p.pending || undefined}>
      <div className="os-bulk-head">
        <label className="os-bulk-count">
          {p.all ? <input ref={box} type="checkbox" checked={p.all.checked} aria-label="Select all shown" onChange={(e) => p.all?.onChange(e.target.checked)} /> : null}
          <span>
            <strong>{p.count}</strong> selected
          </span>
        </label>
        <button type="button" className="os-bulk-clear" onClick={p.onClear}>
          Clear
        </button>
      </div>
      <div className="os-bulk-actions">
        {naming ? (
          <form className="os-bulk-new" onSubmit={addNew}>
            <input className="os-input" autoFocus aria-label="New tag" placeholder="New tag" value={draft} maxLength={40} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setNaming(false)} />
            <button type="submit" className="os-button" disabled={!normalizeTag(draft) || p.pending}>
              Add
            </button>
            <button type="button" className="os-button ghost" onClick={() => setNaming(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <span className="os-select os-bulk-tag">
            <select aria-label="Tag" value="" disabled={p.pending} onChange={(e) => onTag(e.target.value)}>
              <option value="">Tag…</option>
              <optgroup label="Add tag">
                {menu.add.map((t) => (
                  <option key={`a${t}`} value={`add:${t}`}>
                    {t}
                  </option>
                ))}
                <option value={NEW}>New tag…</option>
              </optgroup>
              {menu.remove.length ? (
                <optgroup label="Remove tag">
                  {menu.remove.map((t) => (
                    <option key={`r${t}`} value={`remove:${t}`}>
                      {t}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </span>
        )}
        <button type="button" className="os-button" disabled={p.pending} onClick={p.onWon}>
          Won…
        </button>
        <button type="button" className="os-button" disabled={p.pending} onClick={p.onLost}>
          Lost
        </button>
        <button type="button" className="os-button" disabled={p.pending} onClick={() => p.onArchive(!p.archived)}>
          {p.archived ? "Restore" : "Archive"}
        </button>
        {p.extra}
      </div>
    </div>
  );
}
