"use client";

// Filters and columns for the Contacts table (dm-crm issue 017): each active
// filter is a chip with ×; "+ Filter" adds one (tag, stage, setter,
// category, source, last activity, archived); "Columns" picks which columns
// the view shows. Tags filter by id, shown by their current name.

import { useState } from "react";
import type { ContactKind } from "@/app/generated/prisma/enums";
import type { SetterOption } from "@/lib/os/contacts-board";
import { ACTIVITY_OPTIONS, EMPTY_FILTERS, type ActivityFilter, type ViewFilters, type ViewState } from "@/lib/os/contacts-view";
import type { FunnelColumn } from "@/lib/os/funnel";
import { kindTabs } from "@/lib/os/labels";

type FilterKind = "tag" | "stage" | "setter" | "category" | "source" | "activity";

interface Props {
  state: ViewState;
  onChange: (s: ViewState) => void;
  tags: { id: string; name: string }[];
  setters: SetterOption[];
  sources: string[];
  columnOptions: { key: string; label: string }[];
  /** The board columns of the filtered (or default) setter. */
  stageColumns: FunnelColumn[];
}

const KIND_LABEL: Record<FilterKind, string> = { tag: "Tag", stage: "Stage", setter: "Setter", category: "Category", source: "Source", activity: "Last activity" };

export default function FilterBar(p: Props) {
  const f = p.state.filters;
  const [adding, setAdding] = useState<FilterKind | null>(null);
  const set = (patch: Partial<ViewFilters>) => p.onChange({ ...p.state, filters: { ...f, ...patch } });
  const tagName = (id: string) => p.tags.find((t) => t.id === id)?.name ?? "deleted tag";

  const chips: { key: string; label: string; clear: () => void }[] = [
    ...f.tagIds.map((id) => ({ key: `tag:${id}`, label: `Tag: ${tagName(id)}`, clear: () => set({ tagIds: f.tagIds.filter((t) => t !== id) }) })),
    ...(f.stage ? [{ key: "stage", label: `Stage: ${p.stageColumns.find((c) => c.key === f.stage)?.label ?? f.stage}`, clear: () => set({ stage: "" }) }] : []),
    ...(f.setter ? [{ key: "setter", label: `Setter: ${p.setters.find((s) => s.id === f.setter)?.name ?? "Setter"}`, clear: () => set({ setter: "" }) }] : []),
    ...(f.category ? [{ key: "category", label: `Category: ${kindTabs.find((k) => k.kind === f.category)?.label ?? f.category}`, clear: () => set({ category: "" }) }] : []),
    ...(f.source ? [{ key: "source", label: `Source: ${f.source}`, clear: () => set({ source: "" }) }] : []),
    ...(f.activity ? [{ key: "activity", label: `Last activity: ${ACTIVITY_OPTIONS.find((a) => a.value === f.activity)?.label ?? f.activity}`, clear: () => set({ activity: "" }) }] : []),
  ];

  const options: { value: string; label: string }[] =
    adding === "tag"
      ? p.tags.filter((t) => !f.tagIds.includes(t.id)).map((t) => ({ value: t.id, label: t.name }))
      : adding === "stage"
        ? p.stageColumns.map((c) => ({ value: c.key, label: c.label }))
        : adding === "setter"
          ? p.setters.map((s) => ({ value: s.id, label: s.name }))
          : adding === "category"
            ? kindTabs.map((k) => ({ value: k.kind, label: k.label }))
            : adding === "source"
              ? p.sources.map((s) => ({ value: s, label: s }))
              : adding === "activity"
                ? ACTIVITY_OPTIONS.map((a) => ({ value: a.value, label: a.label }))
                : [];

  function addValue(v: string) {
    if (!adding || !v) return;
    if (adding === "tag") set({ tagIds: [...f.tagIds, v] });
    else if (adding === "category") set({ category: v as ContactKind });
    else if (adding === "activity") set({ activity: v as ActivityFilter });
    else set({ [adding]: v } as Partial<ViewFilters>);
    setAdding(null);
  }

  function toggleColumn(key: string, on: boolean) {
    const cols = on ? [...p.state.columns, key] : p.state.columns.filter((c) => c !== key);
    p.onChange({ ...p.state, columns: cols });
  }

  const any = chips.length > 0 || f.archived;

  return (
    <div className="os-cv-filters" role="group" aria-label="Filters">
      {chips.map((c) => (
        <span key={c.key} className="os-cv-chip">
          {c.label}
          <button type="button" aria-label={`Remove ${c.label}`} onClick={c.clear}>
            ×
          </button>
        </span>
      ))}
      {adding ? (
        <span className="os-select os-cv-add">
          <select autoFocus aria-label={`Pick ${KIND_LABEL[adding]}`} value="" onChange={(e) => addValue(e.target.value)} onBlur={() => setAdding(null)}>
            <option value="">{KIND_LABEL[adding]}…</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </span>
      ) : (
        <span className="os-select os-cv-add">
          <select aria-label="Add a filter" value="" onChange={(e) => setAdding((e.target.value || null) as FilterKind | null)}>
            <option value="">+ Filter</option>
            {(Object.keys(KIND_LABEL) as FilterKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </span>
      )}
      <label className="os-cv-archived">
        <input type="checkbox" checked={f.archived} onChange={(e) => set({ archived: e.target.checked })} />
        Archived
      </label>
      {any ? (
        <button type="button" className="os-link" onClick={() => p.onChange({ ...p.state, filters: EMPTY_FILTERS })}>
          Clear
        </button>
      ) : null}
      <span className="os-cx-grow" />
      <details className="os-cv-columns">
        <summary className="os-button ghost">Columns</summary>
        <div className="os-cv-columns-pop" role="group" aria-label="Columns">
          {p.columnOptions.map((c) => (
            <label key={c.key}>
              <input type="checkbox" checked={p.state.columns.includes(c.key)} disabled={c.key === "name"} onChange={(e) => toggleColumn(c.key, e.target.checked)} />
              {c.label}
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}
