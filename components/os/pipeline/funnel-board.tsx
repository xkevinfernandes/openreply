"use client";

// The Pipeline "All · funnel" board (dm-crm 032): the funnel steps plus Lost,
// across every setter, each person once: Won and Lost hold who is there now,
// everyone else sits in the furthest step reached. "Reached" is Home's funnel
// count (archived included); cards follow the Archived filter. Drops only on
// Won (opens the picker) or Lost, through the stage writer.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import "./funnel-board.css";
import { markFunnelLost, markFunnelWon } from "@/app/(os)/os/pipeline/all/actions";
import WonPicker from "@/components/os/contacts/won-picker";
import { useFunnelWindow } from "@/components/os/pipeline/use-funnel-window";
import { WindowSwitch } from "@/components/os/pipeline/window-switch";
import { formatMoney } from "@/lib/os/money";
import { InfoTip } from "@/components/os/ui/info-tip";
import type { FunnelBoardColumn } from "@/lib/os/crm-funnel";
import { canDropOn, windowLabel as cohortLabel, type AllBoardData, type BoardCard } from "@/lib/os/home-funnel-view";

/** Cards drawn per column; the rest is "+N more". */
const SHOWN = 40;

export function FunnelBoard({ data, currency }: { data: AllBoardData; currency: string }) {
  const [win, setWin] = useFunnelWindow();
  const [archived, setArchived] = useState(false);
  const [drag, setDrag] = useState<{ id: string; from: FunnelBoardColumn } | null>(null);
  const [over, setOver] = useState<FunnelBoardColumn | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [winning, setWinning] = useState<BoardCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const columns = data.windows[win];
  const tip = cohortLabel(win);

  function lose(id: string) {
    setError(null);
    start(async () => {
      const r = await markFunnelLost(id);
      if (r.error) setError(r.error);
      router.refresh();
    });
  }

  function drop(target: FunnelBoardColumn, id: string, from: FunnelBoardColumn) {
    setMenu(null);
    if (!canDropOn(target, from)) return;
    if (target === "won") setWinning(data.cards[id] ?? null);
    else lose(id);
  }

  return (
    <div className="os-fb">
      <div className="os-fb-bar">
        <WindowSwitch value={win} onChange={setWin} />
        <label className="os-fb-arch">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          Archived
        </label>
        <InfoTip label="How this board works">{`${tip} (same switch as Home). Open contacts sit in the furthest step they've reached, whatever setter they're with; Won and Lost hold who's there now. "Reached" always matches the funnel on Home. Drag to Won or Lost; the other steps come from the conversation and the booking.`}</InfoTip>
      </div>

      {error ? (
        <p className="os-fb-err" role="alert">
          {error}
        </p>
      ) : null}

      <div className="os-fb-cols" aria-busy={pending || undefined}>
        {columns.map((col, i) => {
          const cards = col.contactIds.map((id) => data.cards[id]).filter((c): c is BoardCard => !!c && (archived || !c.archived));
          const isStep = col.key !== "lost";
          const droppable = drag ? canDropOn(col.key, drag.from) : false;
          const total = col.key === "won" ? cards.reduce((s, c) => s + (c.wonAmount ?? 0), 0) : 0;
          const rate = i === 0 ? "in the window" : !isStep ? "not a fit, or said no" : col.pctReached === null ? "—" : `${col.pctReached}% of ${columns[i - 1].label.replace(/^[A-Z][a-z]/, (m) => m.toLowerCase())}`;
          return (
            <section
              key={col.key}
              className="os-fb-col"
              aria-label={col.label}
              data-drop={droppable || undefined}
              data-over={(droppable && over === col.key) || undefined}
              data-nodrop={(drag && !droppable) || undefined}
              onDragOver={(e) => {
                if (!droppable) return;
                e.preventDefault();
                setOver(col.key);
              }}
              onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                if (drag) drop(col.key, drag.id, drag.from);
                setDrag(null);
              }}
            >
              <header title={`${tip} · ${cards.length} here now`}>
                <span className="lbl">{col.label}</span>
                <span className="big">
                  <strong>{(isStep ? (col.reached ?? 0) : cards.length).toLocaleString("en-GB")}</strong> {isStep ? "reached" : "here"}
                </span>
                <span className="rate">{rate}</span>
                {isStep ? <span className="here">{cards.length} here</span> : null}
                {col.key === "won" && total ? <span className="total">{formatMoney(total, currency)}</span> : null}
              </header>
              <ul>
                {cards.slice(0, SHOWN).map((c) => (
                  <li
                    key={c.id}
                    className="os-fb-card"
                    draggable
                    data-archived={c.archived || undefined}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", c.id);
                      setDrag({ id: c.id, from: col.key });
                    }}
                    onDragEnd={() => {
                      setDrag(null);
                      setOver(null);
                    }}
                  >
                    <span className="name">{c.name}</span>
                    <span className="meta">
                      {c.setter} · {c.age}
                      {c.wonAmount != null ? ` · ${formatMoney(c.wonAmount, currency)}` : ""}
                    </span>
                    <button type="button" className="os-fb-more" aria-label={`Move ${c.name}`} aria-expanded={menu === c.id} onClick={() => setMenu((m) => (m === c.id ? null : c.id))}>
                      ⋯
                    </button>
                    {menu === c.id ? (
                      <span className="os-fb-menu">
                        {(["won", "lost"] as const).map((t) => (
                          <button key={t} type="button" disabled={!canDropOn(t, col.key)} onClick={() => drop(t, c.id, col.key)}>
                            {t === "won" ? "Won" : "Lost"}
                          </button>
                        ))}
                      </span>
                    ) : null}
                  </li>
                ))}
                {cards.length > SHOWN ? <li className="os-fb-rest">+{cards.length - SHOWN} more</li> : null}
                {!cards.length ? <li className="os-fb-none">{drag && !droppable ? "Set from the conversation" : "No one here"}</li> : null}
              </ul>
            </section>
          );
        })}
      </div>

      {winning ? (
        <WonPicker
          contactIds={[winning.id]}
          who={winning.name}
          onClose={() => setWinning(null)}
          save={(offer, amount) => markFunnelWon(winning.id, offer, amount)}
          onDone={() => {
            setWinning(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
