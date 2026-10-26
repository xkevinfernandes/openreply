"use client";

import { useEffect, useRef } from "react";
import type { ContactStage } from "@/app/generated/prisma/enums";
import Avatar from "@/components/os/inbox/avatar";
import { initialSource, threadName } from "@/components/os/inbox/names";
import type { ContactRow } from "@/lib/os/contacts-board";
import { entryLabels, kindTabs, shortAgo, stageLabels, stageOrder } from "@/lib/os/labels";

// The stage as a status pill: good once a call is booked, bad when lost,
// neutral for everything on the way.
const GOOD_STAGES = new Set<ContactStage>(["CALL_BOOKED", "SHOWED", "WON"]);
const stageTone = (s: ContactStage) => (GOOD_STAGES.has(s) ? "good" : s === "LOST" ? "bad" : "neutral");

interface Props {
  rows: ContactRow[];
  now: number;
  selected: Set<string>;
  openId: string | null;
  showKind: boolean;
  hasSetters: boolean;
  setterName: (id: string | null) => string;
  onToggle: (id: string, on?: boolean) => void;
  onSelectAll: (on: boolean) => void;
  onOpen: (id: string) => void;
  onStage: (id: string, stage: ContactStage) => void;
}

export default function ContactsTable(p: Props) {
  const all = p.rows.length > 0 && p.rows.every((c) => p.selected.has(c.id));
  const some = !all && p.rows.some((c) => p.selected.has(c.id));
  const head = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (head.current) head.current.indeterminate = some;
  }, [some]);

  if (!p.rows.length) return null;

  return (
    <div className="os-ct-table-wrap">
      <table className="os-ct-table">
        <thead>
          <tr>
            <th className="check">
              <input ref={head} type="checkbox" aria-label="Select all shown" checked={all} onChange={(e) => p.onSelectAll(e.target.checked)} />
            </th>
            <th className="contact">Contact</th>
            {p.showKind && <th className="kind">Kind</th>}
            <th className="stage">Stage</th>
            <th className="j">J</th>
            <th className="entry">Entry</th>
            <th className="tags">Tags</th>
            {p.hasSetters && <th className="setter">Setter</th>}
            <th className="when">Last message</th>
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
                <td className="contact">
                  <button type="button" className="os-ct-who" onClick={() => p.onOpen(c.id)}>
                    <Avatar src={c.avatarUrl} username={initialSource(c.username, c.fullName)} size={28} />
                    <span className="who-text">
                      <span className="name">{name}</span>
                      {c.username && c.fullName && <span className="sub">{c.fullName}</span>}
                    </span>
                    {c.draftWaiting && (
                      <span className="os-ct-dot" title="Draft from J waiting">
                        <span className="sr-only">Draft from J waiting</span>
                      </span>
                    )}
                  </button>
                </td>
                {p.showKind && <td className="kind muted">{kindTabs.find((k) => k.kind === c.kind)?.label}</td>}
                <td className="stage">
                  <span className="os-select os-ct-inline-select" data-tone={stageTone(c.stage)}>
                    <select aria-label={`Stage for ${name}`} value={c.stage} onChange={(e) => p.onStage(c.id, e.target.value as ContactStage)}>
                      {stageOrder.map((s) => (
                        <option key={s} value={s}>
                          {stageLabels[s]}
                        </option>
                      ))}
                    </select>
                  </span>
                </td>
                <td className="j muted">
                  {c.paused ? <span className="chip flag">Paused</span> : c.setterStage ? <span className="cap">{c.setterStage}</span> : "—"}
                </td>
                <td className="entry">{c.entryPath ? <span className="chip">{entryLabels[c.entryPath] ?? c.entryPath}</span> : <span className="muted">—</span>}</td>
                <td className="tags">
                  <span className="os-ct-tags">
                    {c.tags.length ? c.tags.map((t) => <span key={t} className="chip quiet">{t}</span>) : <span className="muted">—</span>}
                  </span>
                </td>
                {p.hasSetters && <td className="setter muted">{p.setterName(c.setterId)}</td>}
                <td className="when muted">{shortAgo(c.lastMessageAt, p.now) || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
