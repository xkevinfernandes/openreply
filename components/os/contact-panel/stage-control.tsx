"use client";

// The panel's stage dropdown (dm-crm issue 020): only the moves the move
// table allows; Booked, Showed and No-show disabled ("set from the
// booking"); Won opens the Won picker; Undo Won while on Won; the stage
// history from the stage log. Other moves still go out on the event bus
// ("move-stage"), performed by the screen hosting the panel.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { loadStageHistory, undoContactWon, type StageHistoryRow } from "@/app/(os)/os/contacts/actions";
import WonPicker from "@/components/os/contacts/won-picker";
import { emitOs } from "@/components/os/keys";
import type { ContactPanelData } from "@/lib/os/contact-panel/types";
import { BOOKING_COLUMNS } from "@/lib/os/move-table";

/** Fired on window after the panel changed a stage itself (Won, Undo Won). */
export const CONTACT_MOVED_EVENT = "os:contact-moved";

export function contactMoved(contactId: string) {
  window.dispatchEvent(new CustomEvent(CONTACT_MOVED_EVENT, { detail: { contactId } }));
}

const CAUSES: Record<string, string> = {
  setter: "Setter",
  user: "You",
  booking: "Booking",
  sequence: "Sequence",
  automation: "Automation",
  import: "Import",
  migration: "Migration",
};

export default function StageControl({ data }: { data: ContactPanelData }) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; rows: StageHistoryRow[] } | null>(null);
  const [pending, start] = useTransition();
  const details = useRef<HTMLDetailsElement>(null);
  const { column, columns, targets, won } = data.stage;
  const label = (key: string | null) => columns.find((c) => c.key === key)?.label ?? key ?? "—";
  const who = data.username ?? data.fullName ?? "them";

  function changed() {
    contactMoved(data.contactId);
    router.refresh();
  }

  function choose(key: string) {
    setError(null);
    if (key === column) return;
    if (key === "won") return setPicking(true);
    emitOs("move-stage", { contactId: data.contactId, stage: key });
  }

  function undo() {
    setError(null);
    start(async () => {
      const r = await undoContactWon(data.contactId).catch(() => ({ error: "That didn't save. Try again." }));
      if ("error" in r) setError(r.error);
      else changed();
    });
  }

  // History is per contact and column: a move anywhere reloads it.
  const historyKey = `${data.contactId}:${column}`;
  const history = loaded?.key === historyKey ? loaded.rows : null;

  function fetchHistory() {
    loadStageHistory(data.contactId).then((r) => setLoaded({ key: historyKey, rows: "error" in r ? [] : r }));
  }

  function toggleHistory(open: boolean) {
    if (open && !history) fetchHistory();
  }

  useEffect(() => {
    if (details.current?.open) fetchHistory();
    // Refetch when the contact or its column changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyKey]);

  const option = (key: string) => {
    if (key === column) return { disabled: false, note: "" };
    if (BOOKING_COLUMNS.includes(key)) return { disabled: true, note: " · set from the booking" };
    const t = targets?.find((x) => x.key === key);
    // Without targets (an older host) every non-booking column stays open.
    return t && !t.allowed ? { disabled: true, note: "" } : { disabled: false, note: key === "won" ? "…" : "" };
  };

  return (
    <div className="os-panel-stagebox">
      <label className="os-panel-pill">
        <span className="sr-only">Stage</span>
        <select value={column} onChange={(e) => choose(e.target.value)} aria-label="Stage" disabled={pending}>
          {columns.map((c) => {
            const o = option(c.key);
            return (
              <option key={c.key} value={c.key} disabled={o.disabled}>
                {`${c.label}${o.note}`}
              </option>
            );
          })}
        </select>
      </label>

      {column === "won" ? (
        <span className="os-panel-won">
          {won?.amount ? (
            <span>
              {won.offer ? `${won.offer} · ` : ""}
              {won.amount}
            </span>
          ) : (
            <button type="button" className="os-link" onClick={() => setPicking(true)}>
              Add amount
            </button>
          )}
          <button type="button" className="os-link" onClick={undo} disabled={pending}>
            Undo Won
          </button>
        </span>
      ) : null}

      {error ? (
        <p className="os-panel-stage-error" role="alert">
          {error}
        </p>
      ) : null}

      <details ref={details} className="os-panel-history" onToggle={(e) => toggleHistory((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>Stage history</summary>
        {history === null ? (
          <p className="os-panel-history-empty">Loading…</p>
        ) : history.length === 0 ? (
          <p className="os-panel-history-empty">No moves yet.</p>
        ) : (
          <ol>
            {history.map((h) => (
              <li key={h.id} data-refused={h.outcome === "refused" ? "true" : undefined} title={h.reason ?? undefined}>
                <span className="os-panel-history-move">
                  {label(h.from)} → {label(h.to)}
                  {h.outcome === "refused" ? <span className="os-panel-history-refused">Refused</span> : null}
                </span>
                <span className="os-panel-history-meta">
                  {CAUSES[h.cause] ?? h.cause} · <time dateTime={h.at}>{new Date(h.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time>
                </span>
              </li>
            ))}
          </ol>
        )}
      </details>

      {picking ? (
        <WonPicker
          contactIds={[data.contactId]}
          who={who}
          onClose={() => setPicking(false)}
          onDone={() => {
            setPicking(false);
            changed();
          }}
        />
      ) : null}
    </div>
  );
}
