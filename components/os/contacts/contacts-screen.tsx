"use client";

// Contacts (ContactsA/D): Kanban by default (Table still there), filter
// chips, and a panel that pushes in from the right; the board narrows
// instead of being covered. The panel is F's ContactPanel with the shared
// tabs. Every change shows at once and saves in the background; a failed
// save puts the old value back and says so.

import { useCallback, useMemo, useState, useTransition } from "react";
import { loadPanel, updateContacts } from "@/app/(os)/os/contacts/actions";
import type { ContactKind } from "@/app/generated/prisma/enums";
import ActivityTab from "@/components/os/contact-panel/activity-tab";
import DetailsTab from "@/components/os/contact-panel/details-tab";
import ContactPanel from "@/components/os/contact-panel/panel";
import PanelResizer from "@/components/os/contact-panel/resizer";
import BulkBar from "@/components/os/contacts/bulk-bar";
import ContactsKanban from "@/components/os/contacts/contacts-kanban";
import ContactsTable from "@/components/os/contacts/contacts-table";
import { threadName } from "@/components/os/inbox/names";
import { useOsCommand } from "@/components/os/keys";
import type { ContactDetailsData } from "@/lib/os/contact-panel/details";
import type { ContactPanelData, PanelTab } from "@/lib/os/contact-panel/types";
import type { ContactRow, SetterOption } from "@/lib/os/contacts-board";
import type { ContactChange } from "@/lib/os/contacts-edit";
import {
  allSources,
  allTags,
  applyChangeLocally,
  categoryOf,
  emptyFilters,
  filterContacts,
  onSetter,
  withCategory,
  type ContactFilters,
} from "@/lib/os/contacts-filter";
import { dropOnColumn, funnelColumns } from "@/lib/os/funnel";
import { kindTabs, stageLabels } from "@/lib/os/labels";

type View = "table" | "kanban";

export interface OpenPanel {
  panel: ContactPanelData;
  details: ContactDetailsData;
}

interface Props {
  contacts: ContactRow[];
  setters: SetterOption[];
  truncated: boolean;
  initialView: View;
  now: number;
  initialOpen?: OpenPanel | null;
  initialTab?: PanelTab;
  /** ?setter= deep link. */
  initialSetter?: string | null;
  /** ?stage= deep link: the Kanban column to show first. */
  focusColumn?: string | null;
}

const CATEGORY_OPTIONS: { value: ContactKind | ""; label: string }[] = [...kindTabs.map((k) => ({ value: k.kind, label: k.label })), { value: "", label: "Everyone" }];

export default function ContactsScreen({ contacts, setters, truncated, initialView, now, initialOpen = null, initialTab = "chat", initialSetter = null, focusColumn = null }: Props) {
  const [, startTransition] = useTransition();
  const [rows, setRows] = useState(contacts);
  const [seen, setSeen] = useState(contacts);
  if (contacts !== seen) {
    setSeen(contacts);
    setRows(contacts);
  }

  const defaultSetter = setters.find((s) => s.isDefault) ?? setters[0] ?? null;
  const [view, setView] = useState<View>(initialView);
  const [filters, setFilters] = useState<ContactFilters>(emptyFilters);
  const [setterId, setSetterId] = useState<string>((initialSetter && setters.some((x) => x.id === initialSetter) ? initialSetter : null) ?? defaultSetter?.id ?? "");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState<OpenPanel | null>(initialOpen);
  const [tab, setTab] = useState<PanelTab>(initialTab);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);

  const setter = setters.find((s) => s.id === setterId) ?? null;
  const columns = useMemo(() => funnelColumns(setter?.funnel ?? null), [setter]);
  const visible = useMemo(
    () => filterContacts(rows, filters).filter((c) => !setterId || onSetter(c, setterId, defaultSetter?.id ?? null)),
    [rows, filters, setterId, defaultSetter]
  );
  const sources = useMemo(() => allSources(rows), [rows]);
  const tags = useMemo(() => allTags(rows), [rows]);
  const selectedVisible = useMemo(() => visible.filter((c) => selected.has(c.id)), [visible, selected]);
  const category = categoryOf(filters);
  const categoryLabel = CATEGORY_OPTIONS.find((o) => o.value === category)?.label ?? "Everyone";
  const filtered = filters.source !== "" || category !== "SALES" || setterId !== (defaultSetter?.id ?? "") || filters.query !== "";
  const setterName = useCallback((id: string | null) => (id ? (setters.find((s) => s.id === id)?.name ?? "Setter") : (defaultSetter?.name ?? "Default")), [setters, defaultSetter]);

  function syncUrl(next: { view?: View; c?: string | null; tab?: PanelTab | null }) {
    const url = new URL(window.location.href);
    if (next.view !== undefined) {
      if (next.view === "kanban") url.searchParams.delete("view");
      else url.searchParams.set("view", next.view);
    }
    if (next.c !== undefined) {
      if (next.c) url.searchParams.set("c", next.c);
      else url.searchParams.delete("c");
    }
    if (next.tab !== undefined) {
      if (next.tab && next.tab !== "chat") url.searchParams.set("tab", next.tab);
      else url.searchParams.delete("tab");
    }
    window.history.replaceState(null, "", url);
  }

  function chooseView(next: View) {
    setView(next);
    syncUrl({ view: next });
  }

  function openContact(id: string) {
    if (open?.panel.contactId === id) return;
    syncUrl({ c: id });
    startTransition(async () => {
      const r = await loadPanel(id);
      if ("error" in r) setStatus({ text: r.error, error: true });
      else setOpen(r);
    });
  }

  function closePanel() {
    setOpen(null);
    syncUrl({ c: null, tab: null });
  }

  /** Show the change now, save it, and undo it on the screen if the save fails. */
  const apply = useCallback((ids: string[], change: ContactChange, done?: string) => {
    if (!ids.length) return;
    let before: ContactRow[] = [];
    setRows((r) => {
      before = r;
      return applyChangeLocally(r, ids, change);
    });
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
    });
  }, []);

  const moveTo = useCallback(
    (id: string, columnKey: string, cols = columns) => {
      const plan = dropOnColumn(columnKey, cols);
      if ("error" in plan) {
        setStatus({ text: plan.error, error: true });
        return;
      }
      const c = rows.find((r) => r.id === id);
      const who = c ? threadName(c.username, c.fullName) : "contact";
      const label = cols.find((x) => x.key === columnKey)?.label ?? columnKey;
      apply([id], "setterStage" in plan ? { type: "setterStage", setterStage: plan.setterStage } : { type: "stage", stage: plan.stage }, `Moved ${who} to ${label}.`);
      setOpen((o) => (o && o.panel.contactId === id ? { ...o, panel: { ...o.panel, stage: { ...o.panel.stage, column: columnKey } } } : o));
    },
    [apply, columns, rows]
  );

  // The panel's stage pill speaks on the event bus (components/os/keys.ts).
  useOsCommand("move-stage", (d) => {
    if (!d.contactId || !d.stage) return;
    const cols = open?.panel.contactId === d.contactId ? open.panel.stage.columns : columns;
    moveTo(d.contactId, d.stage, cols);
  });

  function toggle(id: string, on?: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function bulk(change: ContactChange, done: string) {
    apply(
      selectedVisible.map((c) => c.id),
      change,
      done
    );
  }

  const kindLabel = (k: ContactKind) => kindTabs.find((t) => t.kind === k)?.label ?? k;
  const openId = open?.panel.contactId ?? null;

  return (
    <div className="os-cx" data-panel={open ? "open" : undefined}>
      <section className="os-cx-main" aria-labelledby="os-cx-h">
        <header className="os-cx-head">
          <h1 id="os-cx-h">Contacts</h1>
          <span className="os-cx-count">
            {visible.length} {category ? `in ${categoryLabel}` : visible.length === 1 ? "contact" : "contacts"}
          </span>
          <div role="tablist" aria-label="View" className="os-cx-views">
            <button type="button" role="tab" aria-selected={view === "kanban"} onClick={() => chooseView("kanban")}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <rect x="2" y="2.5" width="3.5" height="11" rx="1" />
                <rect x="6.5" y="2.5" width="3.5" height="7" rx="1" />
                <rect x="11" y="2.5" width="3" height="9" rx="1" />
              </svg>
              Kanban
            </button>
            <button type="button" role="tab" aria-selected={view === "table"} onClick={() => chooseView("table")}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2 4h12M2 8h12M2 12h12" />
              </svg>
              Table
            </button>
          </div>
          <span className="os-cx-grow" />
          <label className="os-cx-search">
            <span className="sr-only">Search contacts</span>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" />
              <path d="m10.5 10.5 3 3" />
            </svg>
            <input type="search" placeholder="Search contacts" value={filters.query} onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))} />
          </label>
        </header>

        <div className="os-cx-chips" role="group" aria-label="Filters">
          {setters.length ? (
            <Chip label="Setter" value={setterId} onChange={setSetterId} mark={setter?.name ?? null}>
              {setters.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Chip>
          ) : null}
          <Chip label="Source" value={filters.source} onChange={(v) => setFilters((f) => ({ ...f, source: v }))}>
            <option value="">Any</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Chip>
          <Chip label="Category" value={category} onChange={(v) => setFilters((f) => withCategory(f, v as ContactKind | ""))}>
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.label} value={o.value}>
                {o.label}
              </option>
            ))}
          </Chip>
          {filtered ? (
            <button
              type="button"
              className="os-cx-clear"
              onClick={() => {
                setFilters(emptyFilters);
                setSetterId(defaultSetter?.id ?? "");
              }}
            >
              Clear
            </button>
          ) : null}
          <span className="os-cx-grow" />
          <span className="os-cx-legend">
            <span className="os-cx-draft" aria-hidden="true" />
            Draft waiting
          </span>
          <span className="os-cx-legend">
            <svg className="os-cx-follow" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 13.8A5.8 5.8 0 1 0 8 2.2a5.8 5.8 0 0 0 0 11.6ZM8 4.8V8l2.2 1.4" />
            </svg>
            Follow-up scheduled
          </span>
        </div>

        {view === "table" ? (
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
        ) : null}

        <p className="os-cx-status" role="status" aria-live="polite" data-error={status?.error ? "true" : undefined}>
          {status?.text ?? ""}
        </p>
        {truncated ? <p className="os-cx-status">Showing the 2,000 most recent.</p> : null}

        {rows.length === 0 ? (
          <div className="os-empty">
            <strong>No contacts yet</strong>
          </div>
        ) : visible.length === 0 ? (
          <div className="os-cx-none">
            No contacts match.{" "}
            <button type="button" className="os-link" onClick={() => setFilters(emptyFilters)}>
              Clear
            </button>
          </div>
        ) : view === "table" ? (
          <div className="os-cx-table">
            <ContactsTable
              rows={visible}
              now={now}
              selected={selected}
              openId={openId}
              showKind={filters.scope === "all"}
              setterName={setterName}
              hasSetters={setters.length > 0}
              onToggle={toggle}
              onSelectAll={(on) => setSelected(on ? new Set(visible.map((c) => c.id)) : new Set())}
              onOpen={openContact}
              onStage={(id, stage) => apply([id], { type: "stage", stage }, `Moved to ${stageLabels[stage]}.`)}
            />
          </div>
        ) : (
          <ContactsKanban rows={visible} columns={columns} now={now} openId={openId} onOpen={openContact} onMove={(id, col) => moveTo(id, col)} focusKey={focusColumn} />
        )}
      </section>

      {open ? (
        <div
          className="os-cx-panel"
          onClickCapture={(e) => {
            // The panel keeps its tab in local state: remember the last pick so
            // the next contact opens on it, and put it in the URL.
            const el = (e.target as HTMLElement).closest<HTMLElement>(".os-panel [role=tab]");
            const label = el?.textContent?.trim().toLowerCase().replace(/[^a-z]/g, "") ?? "";
            const key = (["chat", "details", "followups", "activity"] as const).find((k) => label.startsWith(k));
            if (key) {
              setTab(key);
              syncUrl({ tab: key });
            }
          }}
        >
          <PanelResizer />
          <button type="button" className="os-cx-close" aria-label="Close panel" title="Close panel" onClick={closePanel}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
          <ContactPanel
            key={open.panel.contactId}
            data={open.panel}
            tab={tab}
            slots={{
              details: <DetailsTab data={open.panel} details={open.details} />,
              activity: <ActivityTab data={open.panel} />,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function Chip({ label, value, onChange, mark, children }: { label: string; value: string; onChange: (v: string) => void; mark?: string | null; children: React.ReactNode }) {
  return (
    <label className="os-cx-chip" data-active={value ? "true" : undefined}>
      {mark ? (
        <span className="os-cx-chip-mark" aria-hidden="true">
          {mark.charAt(0).toUpperCase()}
        </span>
      ) : null}
      <span className="os-cx-chip-k">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
      </svg>
    </label>
  );
}
