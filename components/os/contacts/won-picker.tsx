"use client";

// The Won picker (dm-crm issue 013, WonPicker board): which offer they
// bought, from the setter's structured offers with the price filled in and
// editable, or a typed offer and amount when there are none. One choice is
// applied to every contact passed in. Saves through markContactsWon (stage
// writer, then the won event's data). Used by Contacts, Pipeline, the
// contact panel, the All · funnel board and Home's "won with no amount".

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { loadWonPicker, markContactsWon } from "@/app/(os)/os/contacts/actions";
import { formatMoney } from "@/lib/os/money";
import type { MarkWonResult } from "@/lib/os/won";
import { parsePrice, type WonPickerData } from "@/lib/os/won-offers";

interface Props {
  contactIds: string[];
  /** "maya.builds" or "3 people". */
  who: string;
  onClose: () => void;
  /** After the save: the offer and amount stored. */
  onDone: (won: { offer: string; amount: number; count: number; refused: string[] }) => void;
  /** Another save for the same choice (the All board, Home's fill-in); default markContactsWon. */
  save?: (offer: string, amount: number) => Promise<MarkWonResult>;
  /** "Mark as Won" by default; "Save" when the win is already there. */
  submitLabel?: string;
}

const OTHER = "__other";

const symbolOf = (currency: string) => formatMoney(0, currency).replace(/[\d.,\s]/g, "") || currency;

export default function WonPicker({ contactIds, who, onClose, onDone, save, submitLabel = "Mark as Won" }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [data, setData] = useState<WonPickerData | null>(null);
  const [pick, setPick] = useState<string>("");
  const [typed, setTyped] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    let live = true;
    loadWonPicker(contactIds).then((r) => {
      if (!live) return;
      if ("error" in r) {
        setError(r.error);
        setData({ currency: "EUR", offers: [], setterName: null });
        setPick(OTHER);
        return;
      }
      setData(r);
      const first = r.offers[0];
      setPick(first ? first.name : OTHER);
      setAmount(first?.price != null ? String(first.price) : "");
    });
    return () => {
      live = false;
    };
    // Once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function choose(name: string) {
    setPick(name);
    setError(null);
    const o = data?.offers.find((x) => x.name === name);
    if (o) setAmount(o.price != null ? String(o.price) : "");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const offer = pick === OTHER ? typed.trim() : pick;
    if (!offer) return setError("Pick or type the offer.");
    const n = parsePrice(amount);
    if (n === null) return setError("Type the amount.");
    setError(null);
    start(async () => {
      const r = await (save ? save(offer, n) : markContactsWon(contactIds, offer, n)).catch(() => ({ error: "That didn't save. Try again." }) as const);
      if (r.error !== undefined) return setError(r.error);
      onDone({ offer, amount: n, count: r.count, refused: r.refused });
    });
  }

  const currency = data?.currency ?? "EUR";
  const offers = data?.offers ?? [];

  return (
    <dialog
      ref={dialog}
      className="os-won"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
    >
      <form className="os-won-card" onSubmit={submit}>
        <h2 id={titleId}>Mark {who} as Won</h2>
        {!data ? (
          <p className="os-won-sub">Loading offers…</p>
        ) : offers.length ? (
          <p className="os-won-sub">Which offer did they buy?{data.setterName ? ` From ${data.setterName}'s offers.` : ""}</p>
        ) : (
          <p className="os-won-sub">What did they buy?</p>
        )}

        {offers.length ? (
          <div className="os-won-offers" role="radiogroup" aria-label="Offer">
            {offers.map((o) => (
              <label key={o.name} className="os-won-offer" data-on={pick === o.name ? "true" : undefined}>
                <input type="radio" name="offer" value={o.name} checked={pick === o.name} onChange={() => choose(o.name)} />
                <span className="os-won-offer-name">
                  {o.name}
                  {o.sub ? <span>{o.sub}</span> : null}
                </span>
                <span className="os-won-price">{o.price != null ? formatMoney(o.price, currency) : "No price"}</span>
              </label>
            ))}
            <label className="os-won-offer" data-on={pick === OTHER ? "true" : undefined}>
              <input type="radio" name="offer" value={OTHER} checked={pick === OTHER} onChange={() => choose(OTHER)} />
              <span className="os-won-offer-name">Something else</span>
            </label>
          </div>
        ) : null}

        {pick === OTHER ? (
          <label className="os-won-field">
            <span>Offer</span>
            <input className="os-input" autoFocus value={typed} maxLength={80} placeholder="Type a name" onChange={(e) => setTyped(e.target.value)} />
          </label>
        ) : null}

        <label className="os-won-field">
          <span>Amount</span>
          <span className="os-won-amount">
            <span aria-hidden="true">{symbolOf(currency)}</span>
            <input className="os-input" inputMode="decimal" value={amount} placeholder="0" aria-label={`Amount in ${currency}`} onChange={(e) => setAmount(e.target.value)} />
          </span>
        </label>

        <p className="os-won-note">Moving them off Won later takes this out of revenue.</p>
        {error ? (
          <p className="os-won-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="os-won-actions">
          <button type="button" className="os-button ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="os-button primary" disabled={pending || !data}>
            {pending ? "Saving…" : submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
