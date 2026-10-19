"use client";

// Inbox A keys: J/K move, ⏎ approve, H hold, R regenerate, E edit the draft.
// They go out on the event bus (components/os/keys.ts); the list answers
// next/prev, the composer the rest. Never while typing, and Enter on a
// focused button or link stays that control's own. Owner: S1.

import { useEffect } from "react";
import { commandForKey, emitOs, isTypingTarget } from "@/components/os/keys";

/** The command a keydown should emit here, or null. Exported for tests. */
export function inboxKeyCommand(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "defaultPrevented" | "repeat"> & { target: EventTarget | null }) {
  if (e.defaultPrevented || e.shiftKey) return null;
  if (isTypingTarget(e.target)) return null;
  const tag = (e.target as HTMLElement | null)?.tagName;
  const cmd = commandForKey(e);
  if (cmd === "approve" && (tag === "BUTTON" || tag === "A" || e.repeat)) return null;
  return cmd;
}

export default function InboxKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // An open dialog (the ⌘K palette) owns the keyboard.
      if (document.querySelector("[role=dialog][aria-modal=true]")) return;
      const cmd = inboxKeyCommand(e);
      if (!cmd) return;
      e.preventDefault();
      emitOs(cmd);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
