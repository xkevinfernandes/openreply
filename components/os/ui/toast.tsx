"use client";

// One short message at the bottom of the screen after a bulk action, with
// Undo when the screen can take it back. Goes away after a few seconds.

import { useCallback, useEffect, useRef, useState } from "react";

export interface ToastMessage {
  text: string;
  bad?: boolean;
  undo?: () => void;
}

export function useToast(ms = 6000) {
  const [toast, setToast] = useState<(ToastMessage & { id: number }) | null>(null);
  const seq = useRef(0);
  const show = useCallback((m: ToastMessage) => setToast({ ...m, id: ++seq.current }), []);
  const hide = useCallback(() => setToast(null), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast((cur) => (cur?.id === toast.id ? null : cur)), toast.undo ? ms + 2000 : ms);
    return () => clearTimeout(t);
  }, [toast, ms]);
  return { toast, show, hide };
}

export function Toast({ toast, onHide }: { toast: ToastMessage | null; onHide: () => void }) {
  return (
    <div className="os-toast-slot" role="status" aria-live="polite">
      {toast ? (
        <div className="os-toast" data-bad={toast.bad || undefined}>
          <span>{toast.text}</span>
          {toast.undo ? (
            <button
              type="button"
              className="os-toast-undo"
              onClick={() => {
                toast.undo?.();
                onHide();
              }}
            >
              Undo
            </button>
          ) : null}
          <button type="button" className="os-toast-x" aria-label="Dismiss" onClick={onHide}>
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
