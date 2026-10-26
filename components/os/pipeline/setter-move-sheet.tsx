"use client";

// "Move selected…" (dm-crm issue 019, PhonePipeline board): one card gets
// the move table's allowed columns; several go to Won or Lost only. Won
// opens the Won picker.

import { useEffect, useRef } from "react";
import type { MoveTarget } from "@/lib/os/move-table";

interface Props {
  count: number;
  targets: MoveTarget[];
  onPick: (key: string) => void;
  onClose: () => void;
}

export default function MoveSheet({ count, targets, onPick, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);
  const shown = targets.filter((t) => t.reason !== "Here now");
  return (
    <dialog
      ref={dialog}
      className="os-won os-pl-sheet"
      aria-label={`Move ${count} selected`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
    >
      <div className="os-won-card">
        <div className="os-pl-sheet-head">
          <h2>Move {count === 1 ? "1 card" : `${count} selected`} to</h2>
          <button type="button" className="os-button ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
        <ul className="os-pl-sheet-list">
          {shown.map((t) => (
            <li key={t.key}>
              <button type="button" className="os-pl-sheet-item" disabled={!t.allowed} onClick={() => onPick(t.key)}>
                <span>{t.key === "won" ? "Won…" : t.label}</span>
                {t.key === "won" ? <span className="os-pl-sheet-why">{count > 1 ? "one offer and amount for all" : "asks for the offer"}</span> : !t.allowed && t.reason ? <span className="os-pl-sheet-why">{t.reason}</span> : null}
              </button>
            </li>
          ))}
        </ul>
        {count > 1 ? <p className="os-won-note">Several cards go to Won or Lost only. Booked, Showed and No-show come from the booking.</p> : null}
      </div>
    </dialog>
  );
}
