"use client";

// The board. Three ways to move a card, all ending in onMove: drag it to a
// column (dragging a selected card takes the whole selection), pick a stage
// in its menu, or focus it and press Shift+← / Shift+→.

import { useEffect, useRef, useState } from "react";
import type { ContactStage } from "@/app/generated/prisma/enums";
import Avatar from "@/components/os/inbox/avatar";
import { initialSource, threadName } from "@/components/os/inbox/names";
import type { ContactRow } from "@/lib/os/contacts-board";
import { groupByStage, stepStage } from "@/lib/os/contacts-filter";
import { entryLabels, shortAgo, stageLabels, stageOrder } from "@/lib/os/labels";

interface Props {
  rows: ContactRow[];
  now: number;
  selected: Set<string>;
  openId: string | null;
  collapsed: Set<ContactStage>;
  onToggleColumn: (stage: ContactStage) => void;
  onToggle: (id: string, on?: boolean) => void;
  onOpen: (id: string) => void;
  onMove: (ids: string[], stage: ContactStage) => void;
}

const DRAG_TYPE = "application/x-os-contact";

export default function ContactsKanban(p: Props) {
  const columns = groupByStage(p.rows);
  const [dragging, setDragging] = useState<string[] | null>(null);
  const [over, setOver] = useState<ContactStage | null>(null);
  const board = useRef<HTMLDivElement>(null);
  // A card moved by keyboard lands in another column (a new element): keep focus on it.
  const refocus = useRef<string | null>(null);

  useEffect(() => {
    const id = refocus.current;
    if (!id) return;
    refocus.current = null;
    const el = board.current?.querySelector<HTMLElement>(`[data-card="${CSS.escape(id)}"] .os-ct-card-main`);
    if (el) {
      el.focus();
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [p.rows]);

  function idsFor(id: string): string[] {
    if (!p.selected.has(id)) return [id];
    return p.rows.filter((c) => p.selected.has(c.id)).map((c) => c.id);
  }

  function drop(stage: ContactStage, e: React.DragEvent) {
    e.preventDefault();
    setOver(null);
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    const ids = (dragging ?? (raw ? raw.split(",") : [])).filter((id) => p.rows.find((c) => c.id === id)?.stage !== stage);
    setDragging(null);
    if (ids.length) p.onMove(ids, stage);
  }

  function keyMove(c: ContactRow, e: React.KeyboardEvent) {
    if (!e.shiftKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    const next = stepStage(c.stage, e.key === "ArrowLeft" ? -1 : 1);
    if (!next) return;
    refocus.current = c.id;
    p.onMove([c.id], next);
  }

  return (
    <div className="os-ct-board" ref={board} data-dragging={dragging ? "true" : undefined}>
      <p id="os-ct-kb-hint" className="sr-only">
        Press Enter to open. Shift plus Left or Right arrow moves the card to the previous or next stage.
      </p>
      {stageOrder.map((stage) => {
        const cards = columns[stage];
        const isCollapsed = p.collapsed.has(stage);
        const label = stageLabels[stage];
        return (
          <section
            key={stage}
            className="os-ct-col"
            data-stage={stage}
            data-collapsed={isCollapsed ? "true" : undefined}
            data-over={over === stage ? "true" : undefined}
            aria-label={`${label}, ${cards.length} ${cards.length === 1 ? "contact" : "contacts"}`}
            onDragOver={(e) => {
              if (!dragging && !e.dataTransfer.types.includes(DRAG_TYPE)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (over !== stage) setOver(stage);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((s) => (s === stage ? null : s));
            }}
            onDrop={(e) => drop(stage, e)}
          >
            <header className="os-ct-col-head">
              <h2>{label}</h2>
              <span className="count">{cards.length}</span>
              <button
                type="button"
                className="os-ct-col-toggle"
                aria-expanded={!isCollapsed}
                aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${label}`}
                onClick={() => p.onToggleColumn(stage)}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  {isCollapsed ? <path d="m6 4 4 4-4 4" /> : <path d="M9.5 4 5.5 8l4 4M13 4 9 8l4 4" />}
                </svg>
              </button>
            </header>
            {!isCollapsed &&
              (cards.length ? (
                <ol className="os-ct-cards">
                  {cards.map((c) => (
                    <Card
                      key={c.id}
                      c={c}
                      now={p.now}
                      picked={p.selected.has(c.id)}
                      open={p.openId === c.id}
                      dragging={Boolean(dragging?.includes(c.id))}
                      onToggle={p.onToggle}
                      onOpen={p.onOpen}
                      onStage={(s) => p.onMove([c.id], s)}
                      onKeyDown={(e) => keyMove(c, e)}
                      onDragStart={(e) => {
                        const ids = idsFor(c.id);
                        e.dataTransfer.setData(DRAG_TYPE, ids.join(","));
                        e.dataTransfer.setData("text/plain", threadName(c.username, c.fullName));
                        e.dataTransfer.effectAllowed = "move";
                        setDragging(ids);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                    />
                  ))}
                </ol>
              ) : (
                <p className="os-ct-col-empty">No contacts</p>
              ))}
          </section>
        );
      })}
    </div>
  );
}

interface CardProps {
  c: ContactRow;
  now: number;
  picked: boolean;
  open: boolean;
  dragging: boolean;
  onToggle: (id: string, on?: boolean) => void;
  onOpen: (id: string) => void;
  onStage: (stage: ContactStage) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

function Card({ c, now, picked, open, dragging, onToggle, onOpen, onStage, onKeyDown, onDragStart, onDragEnd }: CardProps) {
  const name = threadName(c.username, c.fullName);
  const when = shortAgo(c.lastMessageAt, now);
  return (
    <li
      className="os-ct-card"
      data-card={c.id}
      data-picked={picked ? "true" : undefined}
      data-open={open ? "true" : undefined}
      data-dragging={dragging ? "true" : undefined}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <input
        type="checkbox"
        className="os-ct-pick"
        aria-label={`Select ${name}`}
        checked={picked}
        onChange={(e) => onToggle(c.id, e.target.checked)}
      />
      <button type="button" className="os-ct-card-main" aria-describedby="os-ct-kb-hint" onClick={() => onOpen(c.id)} onKeyDown={onKeyDown}>
        <span className="top">
          <Avatar src={c.avatarUrl} username={initialSource(c.username, c.fullName)} size={32} />
          <span className="who-text">
            <span className="name">{c.fullName?.trim() || name}</span>
            {c.username && c.fullName?.trim() && <span className="sub">@{c.username}</span>}
          </span>
          {c.draftWaiting && (
            <span className="os-ct-dot" title="Draft from J waiting">
              <span className="sr-only">Draft from J waiting</span>
            </span>
          )}
        </span>
        <span className="chips">
          {c.entryPath && <span className="chip">{entryLabels[c.entryPath] ?? c.entryPath}</span>}
          {c.paused ? <span className="chip flag">J paused</span> : c.setterStage && <span className="chip quiet">J · {c.setterStage}</span>}
        </span>
      </button>
      <span className="foot">
        {when ? (
          <time dateTime={c.lastMessageAt ?? undefined}>{when}</time>
        ) : (
          <span />
        )}
        <span className="os-select os-ct-card-stage">
          <select aria-label={`Move ${name} to stage`} value={c.stage} onChange={(e) => onStage(e.target.value as ContactStage)}>
            {stageOrder.map((s) => (
              <option key={s} value={s}>
                {stageLabels[s]}
              </option>
            ))}
          </select>
        </span>
      </span>
    </li>
  );
}
