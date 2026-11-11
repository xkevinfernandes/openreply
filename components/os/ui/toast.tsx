"use client";

// One short message at the bottom of the screen after a bulk action, with
// Undo when the screen can take it back. Goes away after a few seconds.
// The shared toast (@claudepreneur/brand ToastProvider, mounted once in the
// OS shell); this keeps the screens' old useToast()/<Toast> calls working.

import { useCallback, useRef } from "react";
import { useToast as useCpToast } from "@claudepreneur/brand/react";

export interface ToastMessage {
  text: string;
  bad?: boolean;
  undo?: () => void;
}

export function useToast(ms = 6000) {
  const { toast: push, dismiss } = useCpToast();
  const last = useRef<number | null>(null);
  const show = useCallback(
    (m: ToastMessage) => {
      if (last.current != null) dismiss(last.current);
      last.current = push({
        title: m.text,
        tone: m.bad ? "bad" : "neutral",
        action: m.undo ? { label: "Undo", onClick: m.undo } : undefined,
        duration: m.undo ? ms + 2000 : ms,
      });
    },
    [push, dismiss, ms]
  );
  const hide = useCallback(() => {
    if (last.current != null) dismiss(last.current);
    last.current = null;
  }, [dismiss]);
  return { toast: null as ToastMessage | null, show, hide };
}

/** The toast now shows in the shell's shared stack; nothing renders here. */
export function Toast(_props: { toast: ToastMessage | null; onHide: () => void }) {
  void _props;
  return null;
}
