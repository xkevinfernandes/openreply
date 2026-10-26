"use client";

// Bulk actions on the selected contacts (dm-crm issue 018): add or remove a
// tag (the tag writer), Won (the Won picker, one choice for all) or Lost
// (the stage writer), archive or restore. At 400px the bar sticks to the
// bottom of the screen.

import { useState } from "react";
import { normalizeTag } from "@/lib/os/contacts-filter";

interface Props {
  selectedCount: number;
  /** The Archived filter is on: offer Restore instead of Archive. */
  archived: boolean;
  /** Every managed tag (suggested when adding). */
  tags: string[];
  /** Tags on at least one selected contact (what Remove can take off). */
  selectedTags: string[];
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onWon: () => void;
  onLost: () => void;
  onArchive: (archived: boolean) => void;
  onClear: () => void;
}

export default function BulkBar(p: Props) {
  const [tag, setTag] = useState("");
  if (!p.selectedCount) return null;

  function addTag(e: React.FormEvent) {
    e.preventDefault();
    const t = normalizeTag(tag);
    if (!t) return;
    p.onAddTag(t);
    setTag("");
  }

  return (
    <div className="os-ct-bulk os-cv-bulk" data-on="true" role="region" aria-label="Bulk actions">
      <span className="os-ct-count">
        <strong>{p.selectedCount}</strong> selected
      </span>
      <form className="os-ct-tag-add" onSubmit={addTag}>
        <input className="os-input" aria-label="Tag to add" placeholder="Add tag" list="os-cv-tag-options" value={tag} maxLength={40} onChange={(e) => setTag(e.target.value)} />
        <datalist id="os-cv-tag-options">
          {p.tags.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <button type="submit" className="os-button" disabled={!normalizeTag(tag)}>
          Add
        </button>
      </form>
      <span className="os-select">
        <select aria-label="Remove tag" value="" disabled={!p.selectedTags.length} onChange={(e) => e.target.value && p.onRemoveTag(e.target.value)}>
          <option value="">Remove tag…</option>
          {p.selectedTags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </span>
      <button type="button" className="os-button" onClick={p.onWon}>
        Won…
      </button>
      <button type="button" className="os-button" onClick={p.onLost}>
        Lost
      </button>
      <button type="button" className="os-button" onClick={() => p.onArchive(!p.archived)}>
        {p.archived ? "Restore" : "Archive"}
      </button>
      <button type="button" className="os-button ghost" onClick={p.onClear}>
        Clear
      </button>
    </div>
  );
}
