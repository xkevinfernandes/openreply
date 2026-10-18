"use client";

// The Automations list (BooSend BS-1 layout in the Review Room look). Rows come
// from lib/os/automations-data.ts; every write goes through OpenReply's own
// API routes (/api/automations PATCH / DELETE, /api/automations/duplicate),
// and thumbnails come live from /api/instagram/posts, as on the old page.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { readCache, writeCache } from "@/lib/client-cache";
import {
  AUTOMATION_FILTERS,
  filterCounts,
  filterRows,
  triggerLabel,
  type AutomationFilter,
  type AutomationRow,
} from "@/lib/os/automations";

interface Props {
  rows: AutomationRow[];
  /** OS_MOCK sample rows: nothing is written. */
  sample: boolean;
  initialFilter: AutomationFilter;
  initialQuery: string;
}

type PostMedia = { id: string; media_url?: string; thumbnail_url?: string };

/** postId → current thumbnail. Instagram URLs expire, so they're fetched, never stored. */
function useThumbnails(rows: AutomationRow[], skip: boolean) {
  const accountIds = useMemo(
    () => [...new Set(rows.filter((r) => r.postId).map((r) => r.instagramAccountId))].sort(),
    [rows]
  );
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    if (skip || !accountIds.length) return;
    let cancelled = false;
    const key = `os-thumbs:${accountIds.join(",")}`;
    const cached = readCache<Record<string, string>>(key, 15 * 60_000);
    // Hydrating from the session cache is a legitimate effect use.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (cached.data) setThumbs(cached.data);
    Promise.all(
      accountIds.map((id) =>
        fetch(`/api/instagram/posts?instagramAccountId=${encodeURIComponent(id)}&limit=50`)
          .then((r) => r.json())
          .then((p) => (p.success ? (p.data as PostMedia[]) : []))
          .catch(() => [] as PostMedia[])
      )
    ).then((lists) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const m of lists.flat()) {
        const url = m.thumbnail_url ?? m.media_url;
        if (url) next[m.id] = url;
      }
      setThumbs(next);
      writeCache(key, next);
    });
    return () => {
      cancelled = true;
    };
  }, [accountIds, skip]);
  return thumbs;
}

function Thumb({ row, src }: { row: AutomationRow; src?: string }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="os-auto-thumb" src={src} alt="" loading="lazy" onError={() => setBroken(true)} />;
  }
  return (
    <span className="os-auto-thumb" data-empty="true" aria-hidden="true">
      {row.dmTriggerEnabled && !row.postId ? (
        <svg viewBox="0 0 16 16">
          <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2v-7Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16">
          <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
          <path d="m6.5 5.8 3.6 2.2-3.6 2.2V5.8Z" />
        </svg>
      )}
    </span>
  );
}

function RowMenu({ row, disabled, onDuplicate, onDelete }: { row: AutomationRow; disabled: boolean; onDuplicate: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="os-auto-menu" ref={ref}>
      <button
        type="button"
        className="os-button ghost os-auto-more"
        aria-label={`More for ${row.name}`}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="3.5" cy="8" r=".6" />
          <circle cx="8" cy="8" r=".6" />
          <circle cx="12.5" cy="8" r=".6" />
        </svg>
      </button>
      {open && (
        <div className="os-auto-pop" role="menu">
          <Link role="menuitem" href={`/os/automations/${row.id}`}>
            Edit
          </Link>
          {row.postUrl && (
            <a role="menuitem" href={row.postUrl} target="_blank" rel="noreferrer">
              Open post
            </a>
          )}
          <button role="menuitem" type="button" onClick={() => (setOpen(false), onDuplicate())}>
            Duplicate
          </button>
          <button role="menuitem" type="button" data-danger="true" onClick={() => (setOpen(false), onDelete())}>
            Delete…
          </button>
        </div>
      )}
    </div>
  );
}

export default function AutomationList({ rows: initialRows, sample, initialFilter, initialQuery }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [filter, setFilter] = useState<AutomationFilter>(initialFilter);
  const [query, setQuery] = useState(initialQuery);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const thumbs = useThumbnails(rows, sample);

  // Fresh server rows (after router.refresh) replace the optimistic copy.
  const [seen, setSeen] = useState(initialRows);
  if (seen !== initialRows) {
    setSeen(initialRows);
    setRows(initialRows);
  }

  // Keep the filter and search in the URL so a refresh or a shared link lands on the same view.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (filter === "all") url.searchParams.delete("filter");
    else url.searchParams.set("filter", filter);
    if (query.trim()) url.searchParams.set("q", query.trim());
    else url.searchParams.delete("q");
    window.history.replaceState(window.history.state, "", url);
  }, [filter, query]);

  const counts = filterCounts(rows);
  const visible = filterRows(rows, filter, query);

  async function call(path: string, init: RequestInit, failure: string) {
    try {
      const res = await fetch(path, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.error || failure);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : failure);
      return false;
    }
  }

  async function toggle(row: AutomationRow) {
    setError(null);
    const isActive = !row.isActive;
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, isActive } : r)));
    if (sample) return;
    setBusy(row.id);
    const ok = await call(
      `/api/automations?id=${encodeURIComponent(row.id)}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive }) },
      "Couldn't change that campaign."
    );
    setBusy(null);
    if (!ok) setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, isActive: row.isActive } : r)));
    router.refresh();
  }

  async function duplicate(row: AutomationRow) {
    setError(null);
    setBusy(row.id);
    if (await call(`/api/automations/duplicate?id=${encodeURIComponent(row.id)}`, { method: "POST" }, "Couldn't duplicate it.")) router.refresh();
    setBusy(null);
  }

  async function remove(row: AutomationRow) {
    if (!confirm(`Delete “${row.name}”? Its DM history goes with it. This can't be undone.`)) return;
    setError(null);
    setBusy(row.id);
    if (await call(`/api/automations?id=${encodeURIComponent(row.id)}`, { method: "DELETE" }, "Couldn't delete it.")) {
      setRows((rs) => rs.filter((r) => r.id !== row.id));
      router.refresh();
    }
    setBusy(null);
  }

  return (
    <section aria-label="Campaigns">
      <div className="os-auto-tools">
        <label className="os-search os-auto-search">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" />
            <path d="m10.5 10.5 3 3" />
          </svg>
          <span className="sr-only">Search automations</span>
          <input type="search" placeholder="Search name, keyword or message" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="os-segmented" role="group" aria-label="Show">
          {AUTOMATION_FILTERS.map((f) => (
            <button key={f.value} type="button" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
              {f.value === "active" && <i className="os-auto-dot" data-on="true" aria-hidden="true" />}
              {f.value === "inactive" && <i className="os-auto-dot" aria-hidden="true" />}
              {f.value === "action" && (
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="8" cy="8" r="5.8" />
                  <path d="M8 5v3.4M8 10.8v.1" />
                </svg>
              )}
              {f.label}
              {f.value !== "all" && counts[f.value] > 0 && <span className="count">{counts[f.value]}</span>}
            </button>
          ))}
        </div>
        <Link href="/os/automations/new" className="os-button primary os-auto-new">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 3v10M3 8h10" />
          </svg>
          Create new
        </Link>
      </div>

      {sample && <p className="os-auto-note">Sample campaigns (OS_MOCK). Changes here aren&apos;t saved.</p>}
      {error && (
        <p className="os-auto-note" data-kind="error" role="alert">
          {error}
        </p>
      )}

      {!rows.length ? (
        <div className="os-auto-empty">
          <span className="os-auto-empty-mark" aria-hidden="true">
            <svg viewBox="0 0 16 16">
              <path d="M8 3v10M3 8h10" />
            </svg>
          </span>
          <strong>No automations yet</strong>
          <p>Pick a post, set a keyword and the DM it sends. J answers when they reply.</p>
          <Link href="/os/automations/new" className="os-button primary">
            Create your first automation
          </Link>
        </div>
      ) : !visible.length ? (
        <div className="os-auto-empty" data-small="true">
          <strong>Nothing here</strong>
          <p>{query ? "No campaign matches that search." : filter === "action" ? "Every running campaign looks healthy." : "No campaigns in this view."}</p>
        </div>
      ) : (
        <div className="os-auto-table" role="table" aria-label="Campaigns">
          <div className="os-auto-row os-auto-headrow" role="row">
            <span role="columnheader">Campaign</span>
            <span role="columnheader">Gate</span>
            <span role="columnheader">Answered by</span>
            <span role="columnheader" className="num">
              Runs
            </span>
            <span role="columnheader" className="num">
              CTR
            </span>
            <span role="columnheader" className="sr-only">
              Active
            </span>
            <span role="columnheader" className="sr-only">
              Actions
            </span>
          </div>
          {visible.map((row) => (
            <div key={row.id} className="os-auto-row" role="row" data-off={row.isActive ? undefined : "true"}>
              <div role="cell" className="os-auto-main">
                <Thumb row={row} src={row.postId ? thumbs[row.postId] : undefined} />
                <div className="os-auto-text">
                  <div className="os-auto-title">
                    <Link href={`/os/automations/${row.id}`}>{row.name}</Link>
                    <span className="os-auto-meta">
                      {triggerLabel(row)}
                      {row.username && <> · @{row.username}</>}
                    </span>
                  </div>
                  <div className="os-auto-keys">
                    {row.matchAnyWord ? (
                      <span className="chip quiet">Any word</span>
                    ) : (
                      row.keywords.map((k) => (
                        <span key={k} className="chip">
                          {k}
                        </span>
                      ))
                    )}
                  </div>
                  <p className="os-auto-opener">{row.opener}</p>
                  {row.actions.length > 0 && (
                    <p className="os-auto-action" title={row.actions.join("\n")}>
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <circle cx="8" cy="8" r="5.8" />
                        <path d="M8 5v3.4M8 10.8v.1" />
                      </svg>
                      {row.actions[0]}
                      {row.actions.length > 1 && <span> +{row.actions.length - 1} more</span>}
                    </p>
                  )}
                </div>
              </div>
              <div role="cell" className="os-auto-gate">
                {row.requireEmail && <span className="chip">Email</span>}
                {row.requireFollow && <span className="chip">Follow</span>}
                {!row.requireEmail && !row.requireFollow && <span className="os-auto-none">None</span>}
              </div>
              <div role="cell" className="os-auto-setter">
                {row.setter ? (
                  <>
                    <span>{row.setter.name}</span>
                    <small>{row.setter.viaCampaign ? "This campaign" : "Account default"}</small>
                  </>
                ) : (
                  <span className="os-auto-none">Bundled files</span>
                )}
              </div>
              <div role="cell" className="num" data-label="Runs">
                {row.runs.toLocaleString("en-GB")}
              </div>
              <div role="cell" className="num" data-label="CTR">
                {row.sent ? `${row.ctr}%` : "–"}
              </div>
              <div role="cell" className="os-auto-switch">
                <button
                  type="button"
                  role="switch"
                  aria-checked={row.isActive}
                  aria-label={`${row.name} is ${row.isActive ? "on" : "off"}`}
                  className="os-switch"
                  disabled={busy === row.id}
                  onClick={() => void toggle(row)}
                >
                  <span className="os-switch-knob" />
                </button>
              </div>
              <div role="cell">
                <RowMenu row={row} disabled={sample || busy === row.id} onDuplicate={() => void duplicate(row)} onDelete={() => void remove(row)} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
