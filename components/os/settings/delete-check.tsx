"use client";

// The one delete dialog for tags and resources: the same title, words and
// buttons. In use, it says what uses it. `refuse` (resources while a campaign,
// workflow or unsent broadcast uses them) only offers Keep it; otherwise
// (tags) Delete anyway.

import { Button, Dialog } from "@claudepreneur/brand/react";
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
  const w = deleteCheckWords({ name, used, refuse });
  return (
    <Dialog
      open
      alert
      onClose={onClose}
      title={w.title}
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Keep it
          </Button>
          {w.confirm ? (
            <Button variant="danger" onClick={onConfirm} loading={pending}>
              {w.confirm}
            </Button>
          ) : null}
        </>
      }
    >
      {w.hint ? <p className="os-tg-hint">{w.hint}</p> : null}
      {note ? <p className="os-tg-hint">{note}</p> : null}
      {error ? (
        <p className="os-tg-error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
