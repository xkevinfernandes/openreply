"use client";

// The one delete dialog for tags and resources: the same title, words and
// buttons. In use, it says what uses it. `refuse` (resources while a campaign,
// workflow or unsent broadcast uses them) only offers Keep it; otherwise
// (tags) Delete anyway.

import { useEffect, useRef } from "react";
import { deleteCheckWords } from "@/lib/os/in-use";

export interface DeleteCheckProps {
  name: string;
  used: { kind: string; name: string }[];
  /** In use means no delete (resources). */
  refuse?: boolean;
  /** What else happens (contacts it comes off, agents that stop offering it). */
  note?: string | null;
  error?: string | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export default function DeleteCheck({ name, used, refuse = false, note, error, pending, onClose, onConfirm }: DeleteCheckProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open && typeof d.showModal === "function") d.showModal();
  }, []);
  const w = deleteCheckWords({ name, used, refuse });
  return (
    <dialog
      ref={ref}
      className="os-tg-dialog"
      aria-label={w.title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="os-tg-form">
        <h2>{w.title}</h2>
        {w.hint ? <p className="os-tg-hint">{w.hint}</p> : null}
        {note ? <p className="os-tg-hint">{note}</p> : null}
        {error ? (
          <p className="os-tg-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="os-tg-form-actions">
          <button type="button" className="os-button" onClick={onClose} disabled={pending}>
            Keep it
          </button>
          {w.confirm ? (
            <button type="button" className="os-button danger" onClick={onConfirm} disabled={pending}>
              {pending ? "Deleting…" : w.confirm}
            </button>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
