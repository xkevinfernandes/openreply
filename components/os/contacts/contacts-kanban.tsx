"use client";

// The board (ContactsA/D): the setter's funnel columns, then Booked,
// Showed / No-show, Won, Lost. Drag a card to another column, or focus it and
// press Shift+← / Shift+→. A funnel column sets J's stage hint; an outcome
// column sets the stage (lib/os/funnel.ts dropOnColumn).

import { useEffect, useRef, useState } from "react";
import { threadName } from "@/components/os/inbox/names";
import { Avatar } from "@/components/os/ui/avatar";
import type { ContactRow } from "@/lib/os/contacts-board";
import { boardColumns, groupByColumn, sourceOf, type BoardColumn } from "@/lib/os/contacts-filter";
import type { FunnelColumn } from "@/lib/os/funnel";
import { shortAgo } from "@/lib/os/labels";

interface Props {
  rows: ContactRow[];
  columns: FunnelColumn[];
  now: number;
  openId: string | null;
  onOpen: (id: string) => void;
  /** A column key from `columns`. */
  onMove: (id: string, column: string) => void;
  /** ?stage= deep link (Home pipeline, ⌘K): scroll to and mark that column. */
  focusKey?: string | null;
}

const DRAG_TYPE = "application/x-os-contact";

export default function ContactsKanban(p: Props) {
  const grouped = groupByColumn(p.rows, p.columns);
  const cols = boardColumns(p.columns);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const board = useRef<HTMLDivElement>(null);
  const refocus = useRef<string | null>(null);

  useEffect(() => {
    const id = refocus.current;
    if (!id) return;
    refocus.current = null;
    const el = board.current?.querySelector<HTMLElement>(`[data-card="${CSS.escape(id)}"]`);
    el?.focus();
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [p.rows]);

  useEffect(() => {
    if (!p.focusKey) return;
    board.current?.querySelector<HTMLElement>("[data-focus]")?.scrollIntoView({ block: "nearest", inline: "start" });
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columnOf = (id: string) => cols.find((c) => c.keys.some((k) => grouped.get(k)?.some((r) => r.id === id)));

  function drop(col: BoardColumn, e: React.DragEvent) {
    e.preventDefault();
    setOver(null);
    const id = dragging ?? e.dataTransfer.getData(DRAG_TYPE);
    setDragging(null);
    if (id && columnOf(id)?.key !== col.key) p.onMove(id, col.key);
  }

  function keyMove(c: ContactRow, e: React.KeyboardEvent) {
    if (!e.shiftKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    const i = cols.findIndex((x) => x.key === columnOf(c.id)?.key) + (e.key === "ArrowLeft" ? -1 : 1);
    const next = cols[i];
    if (!next) return;
    refocus.current = c.id;
    p.onMove(c.id, next.key);
  }

  return (
    <div className="os-cx-scroll">
      <div className="os-cx-board" ref={board} data-dragging={dragging ? "true" : undefined}>
        <p id="os-cx-kb-hint" className="sr-only">
          Press Enter to open. Shift plus Left or Right arrow moves the card to the previous or next column.
        </p>
        {cols.map((col) => {
          const cards = col.keys.flatMap((k) => grouped.get(k) ?? []);
          return (
            <section
              key={col.key}
              className="os-cx-col"
              data-over={over === col.key ? "true" : undefined}
              data-focus={p.focusKey && (col.key === p.focusKey || col.keys.includes(p.focusKey)) ? "true" : undefined}
              aria-label={`${col.label}, ${cards.length}`}
              onDragOver={(e) => {
                if (!dragging && !e.dataTransfer.types.includes(DRAG_TYPE)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (over !== col.key) setOver(col.key);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((s) => (s === col.key ? null : s));
              }}
              onDrop={(e) => drop(col, e)}
            >
              <h2>
                {col.label}
                <span>{cards.length}</span>
              </h2>
              {cards.map((c) => (
                <Card
                  key={c.id}
                  c={c}
                  now={p.now}
                  open={p.openId === c.id}
                  noShow={c.attendance === "NO_SHOW"}
                  onOpen={() => p.onOpen(c.id)}
                  onKeyDown={(e) => keyMove(c, e)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_TYPE, c.id);
                    e.dataTransfer.setData("text/plain", threadName(c.username, c.fullName));
                    e.dataTransfer.effectAllowed = "move";
                    setDragging(c.id);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

interface CardProps {
  c: ContactRow;
  now: number;
  open: boolean;
  noShow: boolean;
  onOpen: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

function Card({ c, now, open, noShow, onOpen, onKeyDown, onDragStart, onDragEnd }: CardProps) {
  const name = c.username ?? threadName(c.username, c.fullName);
  const when = shortAgo(c.lastMessageAt, now);
  const note = c.note ?? (noShow ? "no-show" : null);
  return (
    <button
      type="button"
      className="os-cx-card"
      data-card={c.id}
      aria-current={open ? "true" : undefined}
      aria-describedby="os-cx-kb-hint"
      draggable
      onClick={onOpen}
      onKeyDown={onKeyDown}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <span className="os-cx-card-top">
        <Avatar name={c.username ?? c.fullName} src={c.avatarUrl} size={22} className="os-cx-av" />
        <span className="os-cx-user">{name}</span>
        {c.draftWaiting ? <span className="os-cx-draft" title="Draft waiting" aria-label="Draft waiting" role="img" /> : null}
        {c.followup ? (
          <svg className="os-cx-follow" viewBox="0 0 16 16" role="img" aria-label="Follow-up scheduled">
            <path d="M8 13.8A5.8 5.8 0 1 0 8 2.2a5.8 5.8 0 0 0 0 11.6ZM8 4.8V8l2.2 1.4" />
          </svg>
        ) : null}
      </span>
      {note ? <span className="os-cx-note">{note}</span> : null}
      <span className="os-cx-meta">
        <span>{sourceOf(c)}</span>
        {when ? <time dateTime={c.lastMessageAt ?? undefined}>{when}</time> : null}
      </span>
    </button>
  );
}
