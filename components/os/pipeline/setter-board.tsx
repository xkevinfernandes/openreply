"use client";

// One setter's board (dm-crm issue 019, Pipeline board): its stages, then
// Booked, Showed, No-show, Won, Lost. Drag a card anywhere inside a column it
// may go to (the move table, lib/os/pipeline-board.ts); columns it can't go
// to take no drop; Booked, Showed and No-show say "Set from the booking".
// Each column fills the board's height, so a drop lands anywhere in it.
// Shift+← / Shift+→ moves a focused card to the nearest allowed column.
// At 400px one column shows at a time under column tabs (no drag).

import { useEffect, useRef, useState } from "react";
import { threadName } from "@/components/os/inbox/names";
import { Avatar } from "@/components/os/ui/avatar";
import type { ContactRow } from "@/lib/os/contacts-board";
import { sourceOf } from "@/lib/os/contacts-filter";
import type { FunnelColumn } from "@/lib/os/funnel";
import { shortAgo } from "@/lib/os/labels";
import { formatMoney } from "@/lib/os/money";
import { allowedKeys, isBookingColumn, type BoardLane } from "@/lib/os/pipeline-board";

interface Props {
  lanes: BoardLane[];
  columns: FunnelColumn[];
  currency: string;
  now: number;
  openId: string | null;
  selected: Set<string>;
  /** The phone's one visible column. */
  phoneColumn: string;
  onPhoneColumn: (key: string) => void;
  onOpen: (id: string) => void;
  onToggle: (id: string, on: boolean) => void;
  onMove: (id: string, column: string) => void;
  onUndoWon: (id: string) => void;
  /** ?stage= deep link: scroll to and mark that column. */
  focusKey?: string | null;
}

const DRAG_TYPE = "application/x-os-contact";

/** The browser's own drag snapshot of a rounded card shows square light
 *  corners. Hand it a clone in a transparent, unpainted wrapper instead (in
 *  the board, so it keeps the theme tokens), keep the grab point, and drop
 *  the clone once the browser has its image. */
function setCardDragImage(e: React.DragEvent<HTMLElement>) {
  const card = e.currentTarget;
  const host = card.closest(".os-pl-board");
  if (!host || typeof e.dataTransfer.setDragImage !== "function") return;
  const rect = card.getBoundingClientRect();
  const wrap = document.createElement("div");
  wrap.setAttribute("aria-hidden", "true");
  wrap.style.cssText = `position:fixed;top:-1000px;left:-1000px;width:${rect.width}px;padding:0;margin:0;background:transparent;pointer-events:none;`;
  const ghost = card.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("id");
  ghost.removeAttribute("data-card");
  ghost.style.width = `${rect.width}px`;
  ghost.style.transform = "translateZ(0)";
  wrap.appendChild(ghost);
  host.appendChild(wrap);
  e.dataTransfer.setDragImage(wrap, e.clientX - rect.left, e.clientY - rect.top);
  requestAnimationFrame(() => wrap.remove());
}

export default function PipelineBoard(p: Props) {
  const [dragging, setDragging] = useState<{ id: string; allowed: Set<string>; from: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const board = useRef<HTMLDivElement>(null);
  const refocus = useRef<string | null>(null);

  useEffect(() => {
    const id = refocus.current;
    if (!id) return;
    refocus.current = null;
    const el = board.current?.querySelector<HTMLElement>(`[data-card="${CSS.escape(id)}"] .os-pl-open`);
    el?.focus();
  }, [p.lanes]);

  useEffect(() => {
    if (!p.focusKey) return;
    board.current?.querySelector<HTMLElement>("[data-focus]")?.scrollIntoView({ block: "nearest", inline: "start" });
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function keyMove(c: ContactRow, from: string, e: React.KeyboardEvent) {
    if (!e.shiftKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    const allowed = allowedKeys(c, p.columns);
    const i = p.columns.findIndex((x) => x.key === from);
    const step = e.key === "ArrowLeft" ? -1 : 1;
    for (let j = i + step; j >= 0 && j < p.columns.length; j += step) {
      if (allowed.has(p.columns[j].key)) {
        refocus.current = c.id;
        p.onMove(c.id, p.columns[j].key);
        return;
      }
    }
  }

  return (
    <>
      <div className="os-pl-tabs" role="tablist" aria-label="Columns">
        {p.lanes.map((l) => (
          <button key={l.column.key} type="button" role="tab" aria-selected={p.phoneColumn === l.column.key} onClick={() => p.onPhoneColumn(l.column.key)}>
            {l.column.label}
            <span>{l.cards.length}</span>
          </button>
        ))}
      </div>
      <div className="os-pl-scroll">
        <div className="os-pl-board" ref={board} data-dragging={dragging ? "true" : undefined}>
          <p id="os-pl-kb-hint" className="sr-only">
            Press Enter to open. Shift plus Left or Right arrow moves the card to the previous or next column it can go to.
          </p>
          {p.lanes.map((lane) => {
            const col = lane.column;
            const booking = isBookingColumn(col.key);
            const target = dragging ? dragging.allowed.has(col.key) : false;
            return (
              <section
                key={col.key}
                className="os-pl-col"
                data-booking={booking ? "true" : undefined}
                data-phone={p.phoneColumn === col.key ? "true" : undefined}
                data-target={target ? "true" : undefined}
                data-blocked={dragging && !target && dragging.from !== col.key ? "true" : undefined}
                data-over={over === col.key && target ? "true" : undefined}
                data-focus={p.focusKey && col.key === p.focusKey ? "true" : undefined}
                aria-label={`${col.label}, ${lane.cards.length}`}
                onDragOver={(e) => {
                  if (!dragging || !dragging.allowed.has(col.key)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (over !== col.key) setOver(col.key);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((s) => (s === col.key ? null : s));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  const d = dragging;
                  setDragging(null);
                  if (d && d.allowed.has(col.key)) p.onMove(d.id, col.key);
                }}
              >
                <h2>
                  {col.key === "won" ? "Won" : col.label}
                  <span>{lane.cards.length}</span>
                  {col.key === "won" && lane.total ? <strong className="os-pl-total">{formatMoney(lane.total, p.currency)}</strong> : null}
                </h2>
                {booking ? <p className="os-pl-note">Set from the booking</p> : null}
                {col.key === "won" && lane.noAmount ? <p className="os-pl-note">{lane.noAmount} with no amount</p> : null}
                {lane.cards.map((c) => (
                  <Card
                    key={c.id}
                    c={c}
                    column={col.key}
                    currency={p.currency}
                    now={p.now}
                    open={p.openId === c.id}
                    checked={p.selected.has(c.id)}
                    dragged={dragging?.id === c.id}
                    onOpen={() => p.onOpen(c.id)}
                    onToggle={(on) => p.onToggle(c.id, on)}
                    onUndoWon={() => p.onUndoWon(c.id)}
                    onKeyDown={(e) => keyMove(c, col.key, e)}
                    onDragStart={(e) => {
                      setCardDragImage(e);
                      e.dataTransfer.setData(DRAG_TYPE, c.id);
                      e.dataTransfer.setData("text/plain", threadName(c.username, c.fullName));
                      e.dataTransfer.effectAllowed = "move";
                      setDragging({ id: c.id, allowed: allowedKeys(c, p.columns), from: col.key });
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                  />
                ))}
                {dragging && target ? <p className="os-pl-drop">Drop anywhere here</p> : null}
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}

interface CardProps {
  c: ContactRow;
  column: string;
  currency: string;
  now: number;
  open: boolean;
  checked: boolean;
  dragged: boolean;
  onOpen: () => void;
  onToggle: (on: boolean) => void;
  onUndoWon: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onDragStart: (e: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}

function bookingLine(c: ContactRow): string | null {
  if (!c.booking) return null;
  try {
    return new Date(c.booking.start).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: c.booking.hostTimezone });
  } catch {
    return null;
  }
}

function Card({ c, column, currency, now, open, checked, dragged, onOpen, onToggle, onUndoWon, onKeyDown, onDragStart, onDragEnd }: CardProps) {
  const name = c.username ?? threadName(c.username, c.fullName);
  const when = shortAgo(c.lastActivityAt ?? c.lastMessageAt, now);
  const sub =
    column === "won"
      ? c.won
        ? `${c.won.offer ? `${c.won.offer} · ` : ""}${formatMoney(c.won.amount, currency)}`
        : "No amount yet"
      : column === "booked"
        ? (bookingLine(c) ?? c.note ?? null)
        : (c.note ?? (c.attendance === "NO_SHOW" ? "no-show" : null));
  return (
    <article
      className="os-pl-card"
      data-card={c.id}
      aria-current={open ? "true" : undefined}
      data-checked={checked ? "true" : undefined}
      data-dragged={dragged ? "true" : undefined}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="os-pl-card-top">
        <input type="checkbox" className="os-pl-check" aria-label={`Select ${name}`} checked={checked} onChange={(e) => onToggle(e.target.checked)} />
        <button type="button" className="os-pl-open" aria-describedby="os-pl-kb-hint" onClick={onOpen} onKeyDown={onKeyDown}>
          <Avatar name={c.username ?? c.fullName} src={c.avatarUrl} size={22} className="os-cx-av" />
          <span className="os-cx-user">{name}</span>
          {c.draftWaiting ? <span className="os-cx-draft" title="Draft waiting" aria-label="Draft waiting" role="img" /> : null}
        </button>
      </div>
      {sub ? <span className="os-cx-note">{sub}</span> : null}
      <span className="os-cx-meta">
        <span>{c.tags[0] ?? sourceOf(c)}</span>
        {column === "won" ? (
          <button type="button" className="os-pl-undo" onClick={onUndoWon}>
            Undo Won
          </button>
        ) : when ? (
          <time dateTime={c.lastActivityAt ?? c.lastMessageAt ?? undefined}>{when}</time>
        ) : null}
      </span>
    </article>
  );
}
