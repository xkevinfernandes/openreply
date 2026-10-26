"use client";

// Contacts (dm-crm issues 017/018, Contacts board): a table of people. Saved
// views shared by the workspace (one default), columns picked per view,
// filters (tags by id), search, sort, 50 a page, bulk tag / Won / Lost /
// archive, and today's contact panel pushing in from the right. The board
// moved to Pipeline. Every change shows at once and saves in the background;
// a failed save puts the old value back and says so.

import Link from "next/link";
import { useCallback, useMemo, useState, useTransition } from "react";
import { undoContactsWon, updateContacts } from "@/app/(os)/os/contacts/actions";
import ContactsTable from "@/components/os/contacts/contacts-table";
import FilterBar from "@/components/os/contacts/filter-bar";
import PanelHost, { usePanel, type OpenPanel } from "@/components/os/contacts/panel-host";
import ViewsBar from "@/components/os/contacts/views-bar";
import WonPicker from "@/components/os/contacts/won-picker";
import { useOsCommand } from "@/components/os/keys";
import { threadName } from "@/components/os/inbox/names";
import { BulkBar, Toast, useToast, type ToastMessage } from "@/components/os/ui";
import type { PanelTab } from "@/lib/os/contact-panel/types";
import type { ContactRow, SetterOption } from "@/lib/os/contacts-board";
import type { ContactChange } from "@/lib/os/contacts-edit";
import { allSources, applyChangeLocally } from "@/lib/os/contacts-filter";
import { BUILT_IN_COLUMNS, EMPTY_FILTERS, PAGE_SIZE, queryContacts, queryContext, sameView, type ViewState } from "@/lib/os/contacts-view";
import type { SavedViewRecord } from "@/lib/os/saved-views";

export type { OpenPanel };

export interface TagOption {
  id: string;
  name: string;
  color: string;
}

interface Props {
  contacts: ContactRow[];
  setters: SetterOption[];
  fieldColumns: { key: string; label: string }[];
  tags: TagOption[];
  views: SavedViewRecord[];
  /** ?view=<id>, else the default. */
  initialViewId?: string | null;
  currency: string;
  truncated: boolean;
  now: number;
  initialOpen?: OpenPanel | null;
  initialTab?: PanelTab;
}

export default function ContactsScreen(p: Props) {
  const [, startTransition] = useTransition();
  const [rows, setRows] = useState(p.contacts);
  const [seen, setSeen] = useState(p.contacts);
  if (p.contacts !== seen) {
    setSeen(p.contacts);
    setRows(p.contacts);
  }

  const [views, setViews] = useState(p.views);
  const startView = views.find((v) => v.id === p.initialViewId) ?? views.find((v) => v.isDefault) ?? views[0] ?? null;
  const [viewId, setViewId] = useState<string | null>(startView?.id ?? null);
  const [state, setState] = useState<ViewState>(startView?.state ?? { columns: ["name"], filters: EMPTY_FILTERS, sort: { key: "last", dir: "desc" } });
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [wonFor, setWonFor] = useState<string[] | null>(null);
  const toaster = useToast();
  const onError = useCallback((text: string) => setStatus({ text, error: true }), []);
  const panel = usePanel(p.initialOpen ?? null, p.initialTab ?? "chat", onError);

  const current = views.find((v) => v.id === viewId) ?? null;
  const edited = current ? !sameView(current.state, state) : false;
  const ctx = useMemo(() => queryContext(p.setters, p.tags, p.now), [p.setters, p.tags, p.now]);
  const result = useMemo(() => queryContacts(rows, state, query, page, ctx), [rows, state, query, page, ctx]);
  const sources = useMemo(() => allSources(rows), [rows]);
  const selectedRows = useMemo(() => rows.filter((c) => selected.has(c.id)), [rows, selected]);
  const tagColors = useMemo(() => new Map(p.tags.map((t) => [t.name, t.color])), [p.tags]);
  const columnOptions = useMemo(
    () => [...BUILT_IN_COLUMNS.map((c) => ({ key: c.key as string, label: c.label as string })), ...p.fieldColumns.map((f) => ({ key: `field:${f.key}`, label: f.label }))],
    [p.fieldColumns]
  );

  function changeState(next: ViewState) {
    setState(next);
    setPage(1);
  }

  function pickView(v: SavedViewRecord) {
    setViewId(v.id);
    setState(v.state);
    setPage(1);
    setSelected(new Set());
    const url = new URL(window.location.href);
    if (v.isDefault) url.searchParams.delete("view");
    else url.searchParams.set("view", v.id);
    window.history.replaceState(null, "", url);
  }

  const { show: showToast } = toaster;
  /** Show the change now, save it, and undo it on the screen if the save fails.
   *  `done` goes in the toast (with Undo when the change can be taken back). */
  const apply = useCallback(
    (ids: string[], change: ContactChange, done?: string | ToastMessage) => {
      if (!ids.length) return;
      let before: ContactRow[] = [];
      setRows((r) => {
        before = r;
        return applyChangeLocally(r, ids, change);
      });
      setStatus(null);
      if (done) showToast(typeof done === "string" ? { text: done } : done);
      startTransition(async () => {
        let error: string | undefined;
        try {
          error = (await updateContacts(ids, change)).error;
        } catch {
          error = "That didn't save. Try again.";
        }
        if (error) {
          setRows(before);
          showToast({ text: error, bad: true });
        }
      });
    },
    [showToast]
  );

  /** Undo Won for each (back to Booked when there's a booking, else in conversation). */
  const undoWins = useCallback(
    (ids: string[], before: ContactRow[], promoted: { id: string; kind: string }[]) =>
      startTransition(async () => {
        await undoContactsWon(ids, promoted).catch(() => null);
        const was = new Map(before.map((c) => [c.id, c]));
        setRows((r) => r.map((c) => (ids.includes(c.id) && was.get(c.id) ? was.get(c.id)! : c)));
        showToast({ text: `Undid Won for ${ids.length}.` });
      }),
    [showToast]
  );

  // The panel's stage dropdown speaks on the event bus (components/os/keys.ts).
  useOsCommand("move-stage", (d) => {
    const id = d.contactId;
    if (!id || !d.stage) return;
    const c = rows.find((r) => r.id === id);
    apply([id], { type: "column", column: d.stage }, c ? `Moved ${threadName(c.username, c.fullName)}.` : undefined);
    setTimeout(() => panel.reload(id), 400);
  });

  const n = selectedRows.length;
  const ids = selectedRows.map((c) => c.id);

  return (
    <div className="os-cx os-cv" data-panel={panel.open ? "open" : undefined}>
      <section className="os-cx-main" aria-labelledby="os-cx-h">
        <header className="os-cx-head">
          <h1 id="os-cx-h" className="os-title">
            Contacts
          </h1>
          <span className="os-cx-count">
            {result.total.toLocaleString("en-GB")} {result.total === 1 ? "person" : "people"}
          </span>
          <span className="os-cx-grow" />
          <label className="os-cx-search">
            <span className="sr-only">Search contacts</span>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" />
              <path d="m10.5 10.5 3 3" />
            </svg>
            <input
              type="search"
              placeholder="Search name, username or email"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <Link href="/os/pipeline" className="os-button ghost os-cv-pipe">
            Open pipeline
          </Link>
        </header>

        <ViewsBar
          views={views}
          currentId={viewId}
          state={state}
          edited={edited}
          onPick={pickView}
          onReset={() => current && changeState(current.state)}
          onViews={(next, savedId) => {
            setViews(next);
            const v = next.find((x) => x.id === (savedId ?? viewId)) ?? next.find((x) => x.isDefault) ?? null;
            if (v) {
              setViewId(v.id);
              if (savedId || v.id !== viewId) setState(v.state);
            }
          }}
          onStatus={setStatus}
        />

        <FilterBar
          state={state}
          onChange={changeState}
          tags={p.tags}
          setters={p.setters}
          sources={sources}
          columnOptions={columnOptions}
          stageColumns={ctx.columnsFor(state.filters.setter || ctx.defaultSetterId)}
        />

        <BulkBar
          className="os-cv-bulk"
          count={n}
          all={{ checked: result.rows.length > 0 && result.rows.every((c) => selected.has(c.id)), onChange: (on) => setSelected(on ? new Set(result.rows.map((c) => c.id)) : new Set()) }}
          archived={state.filters.archived}
          tags={p.tags.map((t) => t.name)}
          selectedTags={selectedRows.map((c) => c.tags)}
          onAddTag={(tag) => {
            const fresh = selectedRows.filter((c) => !c.tags.includes(tag)).map((c) => c.id);
            apply(ids, { type: "addTag", tag }, { text: `Tagged ${n} “${tag}”.`, undo: () => apply(fresh, { type: "removeTag", tag }, `Took “${tag}” off again.`) });
          }}
          onRemoveTag={(tag) => {
            const had = selectedRows.filter((c) => c.tags.includes(tag)).map((c) => c.id);
            apply(ids, { type: "removeTag", tag }, { text: `Removed “${tag}” from ${had.length}.`, undo: () => apply(had, { type: "addTag", tag }, `Put “${tag}” back.`) });
          }}
          onWon={() => setWonFor(ids)}
          onLost={() => apply(ids, { type: "column", column: "lost" }, `Moved ${n} to Lost.`)}
          onArchive={(archived) => {
            const list = ids;
            apply(list, { type: "archive", archived }, { text: archived ? `Archived ${n}.` : `Restored ${n}.`, undo: () => apply(list, { type: "archive", archived: !archived }, archived ? "Restored." : "Archived again.") });
            setSelected(new Set());
          }}
          onClear={() => setSelected(new Set())}
        />

        <p className="os-cx-status" role="status" aria-live="polite" data-error={status?.error ? "true" : undefined}>
          {status?.text ?? ""}
        </p>
        {p.truncated ? <p className="os-cx-status">Showing the 2,000 most recent.</p> : null}

        {rows.length === 0 ? (
          <div className="os-cx-none">No contacts yet. They appear when someone DMs or comments.</div>
        ) : result.total === 0 ? (
          <div className="os-cx-none">
            {state.filters.archived ? "No archived contacts match." : "No contacts match."}{" "}
            <button
              type="button"
              className="os-link"
              onClick={() => {
                changeState({ ...state, filters: EMPTY_FILTERS });
                setQuery("");
              }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="os-cx-table">
            <ContactsTable
              rows={result.rows}
              columns={state.columns}
              columnOptions={columnOptions}
              sort={state.sort}
              onSort={(key) => changeState({ ...state, sort: { key, dir: state.sort.key === key && state.sort.dir === "desc" ? "asc" : "desc" } })}
              ctx={ctx}
              setters={p.setters}
              tagColors={tagColors}
              currency={p.currency}
              now={p.now}
              selected={selected}
              openId={panel.openId}
              onToggle={(id, on) =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (on) next.add(id);
                  else next.delete(id);
                  return next;
                })
              }
              onSelectAll={(on) =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  for (const c of result.rows) {
                    if (on) next.add(c.id);
                    else next.delete(c.id);
                  }
                  return next;
                })
              }
              onOpen={(id) => panel.openId !== id && panel.show(id)}
            />
            {result.pages > 1 ? (
              <nav className="os-cv-pages" aria-label="Pages">
                <button type="button" className="os-button ghost" disabled={result.page <= 1} onClick={() => setPage(result.page - 1)}>
                  Previous
                </button>
                <span>
                  {(result.page - 1) * PAGE_SIZE + 1}–{Math.min(result.page * PAGE_SIZE, result.total)} of {result.total.toLocaleString("en-GB")}
                </span>
                <button type="button" className="os-button ghost" disabled={result.page >= result.pages} onClick={() => setPage(result.page + 1)}>
                  Next
                </button>
              </nav>
            ) : null}
          </div>
        )}
      </section>

      {panel.open ? <PanelHost open={panel.open} tab={panel.tab} onTab={panel.setTab} onClose={panel.close} /> : null}
      <Toast toast={toaster.toast} onHide={toaster.hide} />

      {wonFor ? (
        <WonPicker
          contactIds={wonFor}
          who={wonFor.length === 1 ? (rows.find((r) => r.id === wonFor[0])?.username ?? "them") : `${wonFor.length} people`}
          onClose={() => setWonFor(null)}
          onDone={(w) => {
            const done = wonFor;
            const before = rows.filter((c) => done.includes(c.id));
            setWonFor(null);
            setSelected(new Set());
            setRows((r) => r.map((c) => (done.includes(c.id) ? { ...c, kind: "SALES", stage: "WON", won: w.amount !== null && w.offer !== null ? { offer: w.offer, amount: w.amount } : null } : c)));
            showToast({
              text: w.refused.length ? `Marked ${w.count} as Won. ${w.refused.length} couldn't move: ${w.refused[0]}` : `Marked ${w.count} as Won${w.amount === null ? " with no amount" : ""}.`,
              undo: () => undoWins(done, before, w.promoted),
            });
            if (panel.openId && done.includes(panel.openId)) panel.reload(panel.openId);
          }}
        />
      ) : null}
    </div>
  );
}
