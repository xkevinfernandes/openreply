"use client";

// The Contacts table (dm-crm issue 017): the view's columns in order, sort
// by any column header, a checkbox per row, a click opens the panel. At
// 400px each row stacks (name, stage, last activity) with its checkbox.

import { useEffect, useRef } from "react";
import Avatar from "@/components/os/inbox/avatar";
import { initialSource, threadName } from "@/components/os/inbox/names";
import type { ContactRow, SetterOption } from "@/lib/os/contacts-board";
import { sourceOf } from "@/lib/os/contacts-filter";
import { lastActivity, stageKeyOf, type QueryContext, type ViewSort } from "@/lib/os/contacts-view";
import { kindTabs, shortAgo } from "@/lib/os/labels";
import { formatMoney } from "@/lib/os/money";

interface Props {
  rows: ContactRow[];
  columns: string[];
  columnOptions: { key: string; label: string }[];
  sort: ViewSort;
  onSort: (key: string) => void;
  ctx: QueryContext;
  setters: SetterOption[];
  /** Tag name → palette key. */
  tagColors: Map<string, string>;
  currency: string;
  now: number;
  selected: Set<string>;
  openId: string | null;
  onToggle: (id: string, on: boolean) => void;
  onSelectAll: (on: boolean) => void;
  onOpen: (id: string) => void;
}

const stageTone = (key: string) => (key === "won" || key === "showed" || key === "booked" ? "good" : key === "lost" || key === "no_show" ? "bad" : "neutral");

export default function ContactsTable(p: Props) {
  const all = p.rows.length > 0 && p.rows.every((c) => p.selected.has(c.id));
  const some = !all && p.rows.some((c) => p.selected.has(c.id));
  const head = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (head.current) head.current.indeterminate = some;
  }, [some]);

  const cols = p.columns.filter((k) => p.columnOptions.some((o) => o.key === k));
  const label = (k: string) => p.columnOptions.find((o) => o.key === k)?.label ?? k;
  const setterName = (id: string | null) => p.setters.find((s) => s.id === (id ?? p.ctx.defaultSetterId))?.name ?? "—";

  function cell(c: ContactRow, key: string) {
    const name = threadName(c.username, c.fullName);
    switch (key) {
      case "name":
        return (
          <button type="button" className="os-ct-who" onClick={() => p.onOpen(c.id)}>
            <Avatar src={c.avatarUrl} username={initialSource(c.username, c.fullName)} size={28} />
            <span className="who-text">
              <span className="name">{name}</span>
              {c.fields?.business ? <span className="sub">{c.fields.business}</span> : c.username && c.fullName ? <span className="sub">{c.fullName}</span> : null}
            </span>
            {c.archivedAt ? <span className="chip quiet">Archived</span> : null}
          </button>
        );
      case "email":
        return c.email ? <span className="os-cv-ellipsis">{c.email}</span> : <span className="muted">—</span>;
      case "stage": {
        const k = stageKeyOf(c, p.ctx);
        const lbl = p.ctx.columnsFor(c.setterId ?? p.ctx.defaultSetterId).find((x) => x.key === k)?.label ?? k;
        return (
          <span className="os-pill" data-tone={stageTone(k)} title={k === "won" && c.won ? `${c.won.offer} · ${formatMoney(c.won.amount, p.currency)}` : undefined}>
            {lbl}
            {k === "won" && c.won ? ` · ${formatMoney(c.won.amount, p.currency)}` : null}
          </span>
        );
      }
      case "won":
        return c.won ? (
          <span className="os-cv-ellipsis" title={c.won.offer}>
            {formatMoney(c.won.amount, p.currency)}
          </span>
        ) : (
          <span className="muted">—</span>
        );
      case "setter":
        return <span className="muted">{setterName(c.setterId)}</span>;
      case "category":
        return <span className="muted">{kindTabs.find((k) => k.kind === c.kind)?.label ?? c.kind}</span>;
      case "source":
        return <span className="muted">{sourceOf(c)}</span>;
      case "tags":
        return (
          <span className="os-ct-tags">
            {c.tags.length ? (
              c.tags.map((t) => (
                <span key={t} className="os-cv-tag" data-color={p.tagColors.get(t) ?? "gray"}>
                  {t}
                </span>
              ))
            ) : (
              <span className="muted">—</span>
            )}
          </span>
        );
      case "last":
        return <span className="muted">{shortAgo(lastActivity(c), p.now) || "—"}</span>;
      case "created":
        return <span className="muted">{c.createdAt ? new Date(c.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}</span>;
      default: {
        const v = key.startsWith("field:") ? c.fields?.[key.slice(6)] : undefined;
        return v ? <span className="os-cv-ellipsis">{v}</span> : <span className="muted">—</span>;
      }
    }
  }

  return (
    <div className="os-ct-table-wrap">
      <table className="os-ct-table os-cv-table">
        <thead>
          <tr>
            <th className="check">
              <input ref={head} type="checkbox" aria-label="Select all on this page" checked={all} onChange={(e) => p.onSelectAll(e.target.checked)} />
            </th>
            {cols.map((k) => {
              const on = p.sort.key === k;
              return (
                <th key={k} data-col={k} aria-sort={on ? (p.sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                  <button type="button" className="os-cv-sort" onClick={() => p.onSort(k)}>
                    {label(k)}
                    {on ? <span aria-hidden="true">{p.sort.dir === "asc" ? " ↑" : " ↓"}</span> : null}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {p.rows.map((c) => {
            const name = threadName(c.username, c.fullName);
            return (
              <tr key={c.id} aria-selected={p.selected.has(c.id)} data-open={p.openId === c.id ? "true" : undefined}>
                <td className="check">
                  <input type="checkbox" aria-label={`Select ${name}`} checked={p.selected.has(c.id)} onChange={(e) => p.onToggle(c.id, e.target.checked)} />
                </td>
                {cols.map((k) => (
                  <td key={k} data-col={k} onClick={k === "name" ? undefined : () => p.onOpen(c.id)}>
                    {cell(c, k)}
                  </td>
                ))}
                {/* 400px: the stacked row always shows stage and last activity. */}
                {!cols.includes("stage") ? <td data-col="stage" className="os-cv-phone-only">{cell(c, "stage")}</td> : null}
                {!cols.includes("last") ? <td data-col="last" className="os-cv-phone-only">{cell(c, "last")}</td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
