"use client";

// Delete a workflow: an inline confirm (never the browser's confirm()), in
// the builder header and under a row of the Workflows list.

import { useState, useTransition } from "react";
import { deleteWorkflowAction } from "@/app/(os)/os/automations/workflows/actions";
import { callAction, deleteConfirmText } from "@/components/os/workflows/status";

export function DeleteWorkflowConfirm({ id, name, live, onCancel, onDeleted }: { id: string; name: string; live: number; onCancel: () => void; onDeleted: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    setError(null);
    start(async () => {
      const r = await callAction(() => deleteWorkflowAction(id));
      if (r.error !== undefined) setError(r.error);
      else onDeleted();
    });
  }

  return (
    <div className="wf-delete-confirm" role="alertdialog" aria-label={`Delete ${name}`} onKeyDown={(e) => e.key === "Escape" && !pending && onCancel()}>
      <span className="wf-delete-text">{deleteConfirmText(name, live)}</span>
      <button type="button" className="os-button danger" disabled={pending} aria-busy={pending} onClick={confirm}>
        {pending ? "Deleting…" : "Delete"}
      </button>
      <button type="button" className="os-button ghost" disabled={pending} onClick={onCancel} autoFocus>
        Cancel
      </button>
      {error ? (
        <span className="wf-note" data-tone="bad" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
