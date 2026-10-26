"use client";

// Automations › Workflows (WorkflowsList board): one row per workflow, the
// whole row clickable; "New workflow" opens the template picker; the row's
// ⋯ menu deletes it (inline confirm).

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { createWorkflowAction } from "@/app/(os)/os/automations/workflows/actions";
import { DeleteWorkflowConfirm } from "@/components/os/workflows/delete-workflow";
import { WfIcon } from "@/components/os/workflows/icons";
import { TRIGGER_KIND_LABEL } from "@/components/os/workflows/forms";
import { listFunnel } from "@/components/os/workflows/view";
import { callAction, hasUnpublishedChanges, MODE_SHORT, MODE_TIP, STATUS_LABEL, STATUS_TIP, workflowStatus } from "@/components/os/workflows/status";
import { TEMPLATES, type TemplateKey } from "@/components/os/workflows/templates";
import type { WorkflowRow } from "@/components/os/workflows/types";
import { InfoTip } from "@/components/os/ui";
import "@/components/os/workflows/workflows.css";

/** Mini drawings of each template's shape (WorkflowsList board). */
function Sketch({ k }: { k: TemplateKey }) {
  return (
    <svg width="102" height="44" viewBox="0 0 102 44" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      {k === "hold_lead_magnet" && (
        <>
          <rect x="4" y="16" width="18" height="12" rx="2" />
          <rect x="30" y="16" width="18" height="12" rx="2" />
          <circle cx="62" cy="22" r="7" className="wf-sk-ink" />
          <rect x="80" y="4" width="18" height="10" rx="2" />
          <rect x="80" y="17" width="18" height="10" rx="2" />
          <rect x="80" y="30" width="18" height="10" rx="2" />
          <path d="M22 22h8M48 22h7M69 22c5 0 5-13 11-13M69 22h11M69 22c5 0 5 13 11 13" />
        </>
      )}
      {k === "send_link" && (
        <>
          <rect x="4" y="16" width="18" height="12" rx="2" />
          <rect x="30" y="16" width="18" height="12" rx="2" />
          <rect x="56" y="16" width="18" height="12" rx="2" />
          <rect x="82" y="16" width="16" height="12" rx="6" />
          <path d="M22 22h8M48 22h8M74 22h8" />
        </>
      )}
      {k === "start_conversation" && (
        <>
          <rect x="4" y="16" width="18" height="12" rx="2" />
          <rect x="30" y="16" width="18" height="12" rx="2" />
          <circle cx="62" cy="22" r="7" className="wf-sk-ink" />
          <path d="M22 22h8M48 22h7" />
        </>
      )}
      {k === "blank" && (
        <>
          <rect x="40" y="14" width="22" height="16" rx="2" strokeDasharray="3 2" />
          <path d="M51 18v8M47 22h8" />
        </>
      )}
    </svg>
  );
}

export function TemplatePicker({ onClose, resourceSlug }: { onClose: () => void; resourceSlug?: string }) {
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<TemplateKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.("[data-wf-new]")) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    ref.current?.querySelector<HTMLButtonElement>("button[data-default]")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  function pick(k: TemplateKey) {
    setPicked(k);
    setError(null);
    start(async () => {
      const r = await callAction(() => createWorkflowAction(k, resourceSlug));
      if (r?.error) setError(r.error);
    });
  }

  return (
    <div className="wf-picker" role="dialog" aria-label="New workflow" ref={ref}>
      <div className="wf-picker-head">
        <h2>Start from</h2>
        <InfoTip label="About new workflows">New workflows start in Approve each DM: every message waits for you in the Inbox. They stay Not published until you publish them.</InfoTip>
      </div>
      <div className="wf-picker-grid">
        {TEMPLATES.map((t) => (
          <button
            key={t.key}
            type="button"
            className="wf-tpl"
            title={t.description}
            data-default={t.isDefault || undefined}
            data-blank={t.key === "blank" || undefined}
            aria-busy={pending && picked === t.key}
            disabled={pending}
            onClick={() => pick(t.key)}
          >
            <span className="wf-tpl-art">
              <Sketch k={t.key} />
            </span>
            <span className="wf-tpl-name">
              {t.label}
              {t.isDefault ? <span className="wf-tpl-tag">Default</span> : null}
            </span>
          </button>
        ))}
      </div>
      {error ? (
        <p className="wf-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function NewWorkflowButton({ resourceSlug }: { resourceSlug?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="wf-new">
      <button type="button" className="os-button primary wf-new-btn" data-wf-new aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
        <WfIcon name="plus" />
        New workflow
      </button>
      {open ? <TemplatePicker onClose={() => setOpen(false)} resourceSlug={resourceSlug} /> : null}
    </div>
  );
}

/** Live / Off / Not published, plus "Unpublished changes" when the draft moved on. */
export function WorkflowStatusCell({ row, showChanges = true }: { row: Pick<WorkflowRow, "version" | "on" | "unpublished">; showChanges?: boolean }) {
  const status = workflowStatus(row);
  return (
    <span className="wf-status-cell">
      <span className="wf-status" data-status={status} title={STATUS_TIP[status]}>
        <span className="wf-status-dot" aria-hidden="true" />
        {STATUS_LABEL[status]}
      </span>
      {showChanges && hasUnpublishedChanges(row) ? <span className="wf-unpub">Unpublished changes</span> : null}
    </span>
  );
}

export default function WorkflowList({ rows }: { rows: WorkflowRow[] }) {
  if (!rows.length) {
    return (
      <section className="wf-list wf-list-empty" aria-label="Workflows">
        <WfIcon name="randomizer" size={20} />
        <span>No workflows yet</span>
      </section>
    );
  }
  return (
    <section className="wf-list" aria-label="Workflows">
      <div className="wf-list-grid wf-list-head">
        <span>Workflow</span>
        <span>Status</span>
        <span>Trigger</span>
        <span>Mode</span>
        <span className="wf-funnel">
          <span>Triggered</span>
          <span>Replied</span>
          <span>Lead magnet</span>
          <span>Booked</span>
        </span>
        <span />
        <span />
      </div>
      {rows.map((r) => (
        <WorkflowListRow key={r.id} r={r} />
      ))}
    </section>
  );
}

/** One row: the whole row opens the builder; the ⋯ menu holds Delete (inline confirm under the row). */
function WorkflowListRow({ r }: { r: WorkflowRow }) {
  const [menu, setMenu] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [gone, setGone] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  if (gone) return null;
  return (
    <div className="wf-row-wrap" data-confirming={confirming || undefined}>
      <Link href={`/os/automations/workflows/${r.id}`} className="wf-list-grid wf-row">
        <span className="wf-row-name">
          <span className="wf-row-title">{r.name}</span>
          <span className="wf-kws">
            {r.trigger.keywords.length ? r.trigger.keywords.map((k) => <span key={k} className="wf-kw">{k}</span>) : <span className="wf-kw" data-empty="true">No keyword</span>}
          </span>
        </span>
        <WorkflowStatusCell row={r} />
        <span className="wf-trigger-chip">
          <WfIcon name={r.trigger.kind} size={13} />
          {TRIGGER_KIND_LABEL[r.trigger.kind]}
        </span>
        <span className="wf-mode-pill" data-mode={r.mode} title={MODE_TIP[r.mode]}>
          <span className="wf-mode-dot" />
          {MODE_SHORT[r.mode]}
        </span>
        <span className="wf-funnel">
          {listFunnel(r.funnel).map((c) => (
            <span key={c.key} className="wf-fcell">
              <span className="wf-fnum">
                <b>{c.n}</b>
                <span>{c.pct}</span>
              </span>
              <span className="wf-fbar">
                <span style={{ width: `${c.bar}%` }} />
              </span>
            </span>
          ))}
        </span>
        <span>{r.ab ? <span className="wf-ab-badge" title="Randomizer running">A/B</span> : null}</span>
        <span aria-hidden="true" />
      </Link>
      <div className="wf-row-menu" ref={menuRef}>
        <button type="button" className="wf-iconbtn" aria-label={`More for ${r.name}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          <WfIcon name="more" />
        </button>
        {menu ? (
          <div className="wf-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              className="wf-menu-item"
              data-tone="bad"
              onClick={() => {
                setMenu(false);
                setConfirming(true);
              }}
            >
              <WfIcon name="trash" size={14} />
              Delete
            </button>
          </div>
        ) : null}
      </div>
      {confirming ? <DeleteWorkflowConfirm id={r.id} name={r.name} live={r.live} onCancel={() => setConfirming(false)} onDeleted={() => setGone(true)} /> : null}
    </div>
  );
}
