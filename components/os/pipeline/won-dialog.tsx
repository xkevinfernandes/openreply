"use client";

// A small Won picker for the All · funnel board and Home's "won with no
// amount" list: offer, amount (workspace currency) and the date it was won.

import "./funnel-shared.css";
import { useEffect, useRef, useState, useTransition } from "react";

export interface WonValues {
  offer: string;
  amount: number;
  wonAt: string;
}

const dateOnly = (iso: string) => iso.slice(0, 10);

export function WonDialog({
  name,
  currency,
  defaultDate,
  submitLabel = "Mark won",
  onSubmit,
  onClose,
}: {
  name: string;
  currency: string;
  defaultDate: string;
  submitLabel?: string;
  onSubmit: (v: WonValues) => Promise<{ error?: string }>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const amount = Number(String(f.get("amount") ?? "").replace(",", "."));
    const day = String(f.get("date") ?? "");
    if (!Number.isFinite(amount) || String(f.get("amount") ?? "").trim() === "") return setError("Add the amount.");
    // Noon UTC keeps the chosen day in any timezone.
    const wonAt = day ? new Date(`${day}T12:00:00Z`).toISOString() : new Date().toISOString();
    start(async () => {
      const r = await onSubmit({ offer: String(f.get("offer") ?? ""), amount, wonAt });
      if (r.error) setError(r.error);
      else onClose();
    });
  }

  return (
    <dialog ref={ref} className="os-won-dialog" onClose={onClose} onCancel={onClose} aria-label={`Won: ${name}`}>
      <form onSubmit={submit}>
        <h2>
          Won · <strong>{name}</strong>
        </h2>
        <label>
          <span>Offer</span>
          <input name="offer" className="os-input" autoComplete="off" placeholder="What they bought" />
        </label>
        <label>
          <span>Amount ({currency})</span>
          <input name="amount" className="os-input" inputMode="decimal" required autoFocus />
        </label>
        <label>
          <span>Won on</span>
          <input name="date" type="date" className="os-input" defaultValue={dateOnly(defaultDate)} max={dateOnly(new Date().toISOString())} />
        </label>
        {error ? (
          <p className="os-won-err" role="alert">
            {error}
          </p>
        ) : null}
        <div className="os-won-actions">
          <button type="button" className="os-button ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="os-button primary" disabled={pending}>
            {submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
