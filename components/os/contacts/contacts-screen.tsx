"use client";

// The Contacts screen (build step 5, BooSend's contacts page in the Review
// Room look): Table / Kanban, search, filters, selection with bulk actions,
// and a side panel per contact. Every change shows at once and saves in the
// background; a failed save puts the old value back and says so.

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import { updateContacts } from "@/app/(os)/os/contacts/actions";
import type { ContactKind, ContactStage } from "@/app/generated/prisma/enums";
import BulkBar from "@/components/os/contacts/bulk-bar";
import ContactPanel from "@/components/os/contacts/contact-panel";
import ContactsKanban from "@/components/os/contacts/contacts-kanban";
import ContactsTable from "@/components/os/contacts/contacts-table";
import { threadName } from "@/components/os/inbox/names";
import type { ContactRow, SetterOption } from "@/lib/os/contacts-board";
import type { ContactChange } from "@/lib/os/contacts-edit";
import {
  activeFilterCount,
  allTags,
  applyChangeLocally,
  emptyFilters,
  filterContacts,
  type ContactFilters,
} from "@/lib/os/contacts-filter";
import { entryLabels, kindTabs, stageLabels, stageOrder } from "@/lib/os/labels";

type View = "table" | "kanban";

interface Props {
  contacts: ContactRow[];
  setters: SetterOption[];
  truncated: boolean;
  initialView: View;
  now: number;
}

const ENTRY_OPTIONS = [
  { value: "comment", label: entryLabels.comment },
  { value: "keyword_dm", label: entryLabels.keyword_dm },
  { value: "story_reply", label: entryLabels.story_reply },
  { value: "none", label: "Direct (no entry)" },
];

export default function ContactsScreen({ contacts, setters, truncated, initialView, now }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [rows, setRows] = useState(contacts);
  const [seen, setSeen] = useState(contacts);
  // A fresh server read replaces the local copy (after router.refresh()).
  if (contacts !== seen) {
    setSeen(contacts);
    setRows(contacts);
  }

  const [view, setView] = useState<View>(initialView);
  const [filters, setFilters] = useState<ContactFilters>(emptyFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<ContactStage>>(() => new Set());
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);

  const visible = useMemo(() => filterContacts(rows, filters), [rows, filters]);
  const tags = useMemo(() => allTags(rows), [rows]);
  const selectedVisible = useMemo(() => visible.filter((c) => selected.has(c.id)), [visible, selected]);
  const open = openId ? (rows.find((c) => c.id === openId) ?? null) : null;
  const nFilters = activeFilterCount(filters);
  const setterName = useCallback(
    (id: string | null) => (id ? (setters.find((s) => s.id === id)?.name ?? "Setter") : "Default"),
    [setters]
  );

  function chooseView(next: View) {
    setView(next);
    const url = new URL(window.location.href);
    if (next === "kanban") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    window.history.replaceState(null, "", url);
  }

  const setFilter = <K extends keyof ContactFilters>(key: K, value: ContactFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  function toggle(id: string, on?: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function selectAll(on: boolean) {
    setSelected(on ? new Set(visible.map((c) => c.id)) : new Set());
  }

  /** Show the change now, save it, and undo it on the screen if the save fails. */
  const apply = useCallback(
    (ids: string[], change: ContactChange, done?: string) => {
      if (!ids.length) return;
      const before = rows;
      setRows(applyChangeLocally(rows, ids, change));
      setStatus(done ? { text: done } : null);
      startTransition(async () => {
        let error: string | undefined;
        try {
          error = (await updateContacts(ids, change)).error;
        } catch {
          error = "That didn't save. Try again.";
        }
        if (error) {
          setRows(before);
          setStatus({ text: error, error: true });
        }
        router.refresh();
      });
    },
    [router, rows]
  );

  const moveTo = useCallback(
    (ids: string[], stage: ContactStage) => {
      const first = rows.find((c) => c.id === ids[0]);
      const who = ids.length === 1 && first ? threadName(first.username, first.fullName) : `${ids.length} contacts`;
      apply(ids, { type: "stage", stage }, `Moved ${who} to ${stageLabels[stage]}.`);
    },
    [apply, rows]
  );

  function bulk(change: ContactChange, done: string) {
    apply(
      selectedVisible.map((c) => c.id),
      change,
      done
    );
  }

  const toggleColumn = (stage: ContactStage) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });

  const kindLabel = (k: ContactKind) => kindTabs.find((t) => t.kind === k)?.label ?? k;

  return (
    <div className="os-ct" data-panel-open={open ? "true" : undefined}>
      <div className="os-ct-toolbar">
        <label className="os-search os-ct-search">
          <span className="sr-only">Search contacts</span>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" />
            <path d="m10.5 10.5 3 3" />
          </svg>
          <input
            type="search"
            placeholder="Search name, handle, email, tag"
            value={filters.query}
            onChange={(e) => setFilter("query", e.target.value)}
          />
        </label>

        <div className="os-segmented" role="group" aria-label="View">
          <button type="button" aria-pressed={view === "table"} onClick={() => chooseView("table")}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <rect x="2.5" y="3" width="11" height="10" rx="1" />
              <path d="M2.5 6.5h11M6 6.5V13" />
            </svg>
            Table
          </button>
          <button type="button" aria-pressed={view === "kanban"} onClick={() => chooseView("kanban")}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 3v10M8 3v6M12 3v8" />
            </svg>
            Kanban
          </button>
        </div>

        <div className="os-segmented" role="group" aria-label="Who to show">
          <button type="button" aria-pressed={filters.scope === "sales"} onClick={() => setFilters((f) => ({ ...f, scope: "sales", kind: "" }))}>
            Sales
          </button>
          <button type="button" aria-pressed={filters.scope === "all"} onClick={() => setFilter("scope", "all")}>
            Everyone
          </button>
        </div>

        <button
          type="button"
          className="os-button ghost os-ct-filter-toggle"
          aria-expanded={showFilters}
          aria-controls="os-ct-filters"
          onClick={() => setShowFilters((v) => !v)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2.5 4h11M4.5 8h7M6.5 12h3" />
          </svg>
          Filter
          {nFilters > 0 && <span className="os-ct-badge">{nFilters}</span>}
        </button>

        {view === "kanban" && (
          <div className="os-ct-collapse">
            <button type="button" className="os-button ghost" onClick={() => setCollapsed(new Set(stageOrder))}>
              Collapse all
            </button>
            <button type="button" className="os-button ghost" disabled={!collapsed.size} onClick={() => setCollapsed(new Set())}>
              Expand all
            </button>
          </div>
        )}
      </div>

      {showFilters && (
        <div className="os-ct-filters" id="os-ct-filters" role="group" aria-label="Filters">
          {filters.scope === "all" && (
            <FilterSelect label="Kind" value={filters.kind} onChange={(v) => setFilter("kind", v as ContactKind | "")}>
              {kindTabs.map((k) => (
                <option key={k.kind} value={k.kind}>
                  {k.label}
                </option>
              ))}
            </FilterSelect>
          )}
          <FilterSelect label="Stage" value={filters.stage} onChange={(v) => setFilter("stage", v as ContactStage | "")}>
            {stageOrder.map((s) => (
              <option key={s} value={s}>
                {stageLabels[s]}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Entry path" value={filters.entry} onChange={(v) => setFilter("entry", v)}>
            {ENTRY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Setter" value={filters.setter} onChange={(v) => setFilter("setter", v)}>
            <option value="default">Default setter</option>
            {setters.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Tag" value={filters.tag} onChange={(v) => setFilter("tag", v)} disabled={!tags.length}>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </FilterSelect>
          {nFilters > 0 && (
            <button
              type="button"
              className="os-link quiet"
              onClick={() => setFilters((f) => ({ ...emptyFilters, scope: f.scope, query: f.query }))}
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      <BulkBar
        selectedCount={selectedVisible.length}
        visibleCount={visible.length}
        selectedTags={allTags(selectedVisible)}
        tags={tags}
        onStage={(stage) => bulk({ type: "stage", stage }, `Moved ${selectedVisible.length} to ${stageLabels[stage]}.`)}
        onKind={(kind) => bulk({ type: "kind", kind }, `Marked ${selectedVisible.length} as ${kindLabel(kind)}.`)}
        onAddTag={(tag) => bulk({ type: "addTag", tag }, `Tagged ${selectedVisible.length} “${tag}”.`)}
        onRemoveTag={(tag) => bulk({ type: "removeTag", tag }, `Removed “${tag}” from ${selectedVisible.length}.`)}
        onPause={(paused) => bulk({ type: "paused", paused }, paused ? `Paused J for ${selectedVisible.length}.` : `J is back on for ${selectedVisible.length}.`)}
        onClear={() => setSelected(new Set())}
      />

      <p className="os-ct-status" role="status" aria-live="polite" data-error={status?.error ? "true" : undefined}>
        {status?.text ?? ""}
      </p>

      {truncated && <p className="os-ct-note">Showing the 2,000 most recent contacts.</p>}

      {rows.length === 0 ? (
        <div className="os-empty">
          <strong>No contacts yet</strong>
          Everyone who comments on a campaign or writes to you in the Inbox shows up here.
        </div>
      ) : view === "table" ? (
        <ContactsTable
          rows={visible}
          now={now}
          selected={selected}
          openId={openId}
          showKind={filters.scope === "all"}
          setterName={setterName}
          hasSetters={setters.length > 0}
          onToggle={toggle}
          onSelectAll={selectAll}
          onOpen={setOpenId}
          onStage={(id, stage) => moveTo([id], stage)}
        />
      ) : (
        <ContactsKanban
          rows={visible}
          now={now}
          selected={selected}
          openId={openId}
          collapsed={collapsed}
          onToggleColumn={toggleColumn}
          onToggle={toggle}
          onOpen={setOpenId}
          onMove={moveTo}
        />
      )}

      {visible.length === 0 && rows.length > 0 && (
        <div className="os-ct-none">
          No contacts match.{" "}
          <button type="button" className="os-link" onClick={() => setFilters(emptyFilters)}>
            Show everyone in Sales
          </button>
        </div>
      )}

      <ContactPanel
        contact={open}
        now={now}
        setterName={setterName}
        onClose={() => setOpenId(null)}
        onChange={(change, done) => open && apply([open.id], change, done)}
      />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  disabled,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="os-ct-filter" data-active={value ? "true" : undefined}>
      <span>{label}</span>
      <span className="os-select">
        <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          <option value="">Any</option>
          {children}
        </select>
      </span>
    </label>
  );
}
