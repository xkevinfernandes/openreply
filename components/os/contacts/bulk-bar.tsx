"use client";

import { useState } from "react";
import type { ContactKind, ContactStage } from "@/app/generated/prisma/enums";
import { normalizeTag } from "@/lib/os/contacts-filter";
import { kindTabs, stageLabels, stageOrder } from "@/lib/os/labels";

interface Props {
  selectedCount: number;
  visibleCount: number;
  /** Tags on at least one selected contact (what Remove can take off). */
  selectedTags: string[];
  /** Every tag in the workspace, suggested when adding. */
  tags: string[];
  onStage: (stage: ContactStage) => void;
  onKind: (kind: ContactKind) => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onPause: (paused: boolean) => void;
  onClear: () => void;
}

/** "N selected of M" and the bulk actions. Each select acts on choose and
 *  springs back to its label, so the same action can run again. */
export default function BulkBar(p: Props) {
  const [tag, setTag] = useState("");
  const on = p.selectedCount > 0;

  function addTag(e: React.FormEvent) {
    e.preventDefault();
    const t = normalizeTag(tag);
    if (!t) return;
    p.onAddTag(t);
    setTag("");
  }

  return (
    <div className="os-ct-bulk" data-on={on ? "true" : undefined} role="region" aria-label="Bulk actions">
      <span className="os-ct-count">
        <strong>{p.selectedCount}</strong> selected of {p.visibleCount}
      </span>
      {on && (
        <>
          <span className="os-select">
            <select aria-label="Set stage" value="" onChange={(e) => e.target.value && p.onStage(e.target.value as ContactStage)}>
              <option value="">Set stage…</option>
              {stageOrder.map((s) => (
                <option key={s} value={s}>
                  {stageLabels[s]}
                </option>
              ))}
            </select>
          </span>
          <span className="os-select">
            <select aria-label="Set kind" value="" onChange={(e) => e.target.value && p.onKind(e.target.value as ContactKind)}>
              <option value="">Set kind…</option>
              {kindTabs.map((k) => (
                <option key={k.kind} value={k.kind}>
                  {k.label}
                </option>
              ))}
            </select>
          </span>
          <form className="os-ct-tag-add" onSubmit={addTag}>
            <input
              className="os-input"
              aria-label="Tag to add"
              placeholder="Add tag"
              list="os-ct-tag-options"
              value={tag}
              maxLength={40}
              onChange={(e) => setTag(e.target.value)}
            />
            <datalist id="os-ct-tag-options">
              {p.tags.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <button type="submit" className="os-button" disabled={!normalizeTag(tag)}>
              Add
            </button>
          </form>
          <span className="os-select">
            <select
              aria-label="Remove tag"
              value=""
              disabled={!p.selectedTags.length}
              onChange={(e) => e.target.value && p.onRemoveTag(e.target.value)}
            >
              <option value="">Remove tag…</option>
              {p.selectedTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </span>
          <button type="button" className="os-button" onClick={() => p.onPause(true)}>
            Pause J
          </button>
          <button type="button" className="os-button" onClick={() => p.onPause(false)}>
            Resume J
          </button>
          <button type="button" className="os-button ghost" onClick={p.onClear}>
            Clear
          </button>
        </>
      )}
    </div>
  );
}
