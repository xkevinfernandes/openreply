"use client";

// The in-app "are you sure" in place of the browser's window.confirm(): the
// shared ConfirmDialog (@claudepreneur/brand useConfirm), mounted once in the
// OS shell. useOsConfirm()(text, opts) resolves true on confirm, like
// window.confirm did; the question's first sentence is the title, the rest
// the description, word for word.

import { createContext, useCallback, useContext } from "react";
import { useConfirm } from "@claudepreneur/brand/react";

interface AskOptions {
  confirmLabel?: string;
  danger?: boolean;
}
type Ask = (text: string, opts?: AskOptions) => Promise<boolean>;

const Ctx = createContext<Ask | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const { confirm, dialog } = useConfirm();
  const ask = useCallback<Ask>(
    (text, opts = {}) => {
      const cut = text.search(/[?.](\s|$)/);
      const title = cut >= 0 ? text.slice(0, cut + 1) : text;
      const rest = cut >= 0 ? text.slice(cut + 1).trim() : "";
      return confirm({ title, description: rest || undefined, ...opts });
    },
    [confirm]
  );
  return (
    <Ctx.Provider value={ask}>
      {children}
      {dialog}
    </Ctx.Provider>
  );
}

/** Outside the shell (tests) it falls back to window.confirm. */
export function useOsConfirm(): Ask {
  return useContext(Ctx) ?? (async (text) => window.confirm(text));
}
