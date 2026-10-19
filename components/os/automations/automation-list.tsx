"use client";

// Campaigns (AutomationsA board): trigger chips, then one row per campaign:
// keyword → lead magnet (A/B badge), trigger, opener + link, setter, status,
// Triggered / Replied / Booked. Status toggles the campaign through
// OpenReply's own /api/automations; the ⋯ menu keeps Edit / Duplicate / Delete.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { chipCounts, matchesChip, shortLink, TRIGGER_CHIPS, triggerSummary, type AutomationRow, type TriggerChip } from "@/lib/os/automations";

interface Props {
  rows: AutomationRow[];
  /** OS_MOCK sample rows: nothing is written. */
  sample: boolean;
  initialChip: TriggerChip;
}

const ARROW = "M3 8h10M9.5 4.5 13 8l-3.5 3.5";
const LINK = "M6.5 9.5 9.5 6.5M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1";

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
      <button type="button" className="os-auto-more" aria-label={`More for ${row.name}`} aria-expanded={open} disabled={disabled} onClick={() => setOpen((o) => !o)}>
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

export default function AutomationList({ rows: initialRows, sample, initialChip }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [chip, setChip] = useState<TriggerChip>(initialChip);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fresh server rows (after router.refresh) replace the optimistic copy.
  const [seen, setSeen] = useState(initialRows);
  if (seen !== initialRows) {
    setSeen(initialRows);
    setRows(initialRows);
  }

  useEffect(() => {
    const url = new URL(window.location.href);
    if (chip === "all") url.searchParams.delete("trigger");
    else url.searchParams.set("trigger", chip);
    window.history.replaceState(window.history.state, "", url);
  }, [chip]);

  const counts = chipCounts(rows);
  const visible = rows.filter((r) => matchesChip(r, chip));

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
    <>
      <div className="os-auto-chips" role="group" aria-label="Filter campaigns by trigger">
        {TRIGGER_CHIPS.map((c) => (
          <button key={c.value} type="button" aria-pressed={chip === c.value} onClick={() => setChip(c.value)}>
            {c.label} <span className="n">{counts[c.value]}</span>
          </button>
        ))}
      </div>

      {error && (
        <p className="os-auto-note" data-kind="error" role="alert">
          {error}
        </p>
      )}

      {!rows.length ? (
        <div className="os-auto-empty">
          <strong>No campaigns yet</strong>
          <Link href="/os/automations/new" className="os-button primary">
            New campaign
          </Link>
        </div>
      ) : (
        <section className="os-auto-grid" aria-label="Campaigns">
          <div className="os-auto-r os-auto-hr" aria-hidden="true">
            <span>Keyword</span>
            <span>Trigger</span>
            <span>Opener DM</span>
            <span>Setter</span>
            <span>Status</span>
            <span className="num">Triggered</span>
            <span className="num">Replied</span>
            <span className="num">Booked</span>
            <span />
          </div>
          {!visible.length ? (
            <p className="os-auto-none">No campaigns with this trigger yet.</p>
          ) : (
            visible.map((row) => {
              const t = triggerSummary(row);
              const kw = row.matchAnyWord ? "Any word" : (row.keywords[0] ?? "—");
              const more = row.matchAnyWord ? 0 : Math.max(0, row.keywords.length - 1);
              const edit = sample ? undefined : `/os/automations/${row.id}`;
              const warn = row.isActive && row.actions.length > 0;
              return (
                <div key={row.id} className="os-auto-r" data-off={row.isActive ? undefined : "true"}>
                  <span className="os-auto-kw">
                    <span className="line">
                      {edit ? (
                        <Link href={edit} className="chip" title={row.keywords.join(", ")}>
                          {kw.toUpperCase()}
                        </Link>
                      ) : (
                        <span className="chip">{kw.toUpperCase()}</span>
                      )}
                      {more ? <span className="more">+{more}</span> : null}
                      <svg viewBox="0 0 16 16" role="img" aria-label="maps to">
                        <path d={ARROW} />
                      </svg>
                      <span className="res" data-empty={row.resource ? undefined : "true"} title={row.resource?.viaLink ? "From the link" : undefined}>
                        {row.resource?.name ?? "No lead magnet"}
                      </span>
                    </span>
                    {row.ab ? <span className="ab">A/B running</span> : null}
                  </span>
                  <span className="os-auto-two">
                    <span>{t.trigger}</span>
                    <span className="sub">{t.where}</span>
                  </span>
                  <span className="os-auto-two">
                    <span className="clip">{row.opener}</span>
                    {row.link ? (
                      <span className="sub os-auto-link">
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d={LINK} />
                        </svg>
                        <span className="clip">{shortLink(row.link)}</span>
                      </span>
                    ) : null}
                  </span>
                  <span className="os-auto-setter2">
                    {row.setter ? (
                      <>
                        <span className="av" data-default={row.setter.viaCampaign ? undefined : "true"} aria-hidden="true">
                          {row.setter.name.charAt(0).toUpperCase()}
                        </span>
                        {row.setter.name}
                      </>
                    ) : (
                      <span className="sub">—</span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="os-auto-status"
                    data-state={warn ? "warn" : row.isActive ? "live" : "off"}
                    aria-pressed={row.isActive}
                    aria-label={`${row.name}: ${row.isActive ? "live, click to pause" : "paused, click to go live"}`}
                    title={warn ? row.actions.join("\n") : undefined}
                    disabled={busy === row.id}
                    onClick={() => void toggle(row)}
                  >
                    <span className="dot" aria-hidden="true" />
                    {warn ? "Fix" : row.isActive ? "Live" : "Paused"}
                  </button>
                  <span className="num">{row.runs.toLocaleString("en-GB")}</span>
                  <span className="num">{(row.replied ?? 0).toLocaleString("en-GB")}</span>
                  <span className="num">{(row.booked ?? 0).toLocaleString("en-GB")}</span>
                  <RowMenu row={row} disabled={sample || busy === row.id} onDuplicate={() => void duplicate(row)} onDelete={() => void remove(row)} />
                </div>
              );
            })
          )}
        </section>
      )}
    </>
  );
}
