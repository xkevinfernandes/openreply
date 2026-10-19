"use client";

// The DM OS event bus (frozen after wave 0). Keyboard shortcuts, the ⌘K
// palette and buttons all speak through window CustomEvents named "os:<cmd>",
// so the composer (S1) and the palette (S6) never import each other.
//
//   emitOs("approve")                       // ⏎ / palette "Approve"
//   useOsCommand("approve", () => send());   // whoever owns the open draft

import { useEffect, useRef } from "react";

export const OS_COMMANDS = ["approve", "hold", "regenerate", "focus-draft", "move-stage", "send-resource", "next", "prev"] as const;
export type OsCommand = (typeof OS_COMMANDS)[number];

/** Open the ⌘K palette (optionally prefilled, e.g. ">" for actions only). */
export const PALETTE_EVENT = "os:palette";

export interface OsCommandDetail {
  contactId?: string;
  /** move-stage: the funnel column key. */
  stage?: string;
  /** send-resource: the Resource id. */
  resourceId?: string;
}

export function osEventName(cmd: OsCommand): string {
  return `os:${cmd}`;
}

export function emitOs(cmd: OsCommand, detail: OsCommandDetail = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<OsCommandDetail>(osEventName(cmd), { detail }));
}

export function onOs(cmd: OsCommand, handler: (detail: OsCommandDetail) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<OsCommandDetail>).detail ?? {});
  window.addEventListener(osEventName(cmd), listener);
  return () => window.removeEventListener(osEventName(cmd), listener);
}

export function useOsCommand(cmd: OsCommand, handler: (detail: OsCommandDetail) => void): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => onOs(cmd, (d) => ref.current(d)), [cmd]);
}

export function openPalette(query = ""): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PALETTE_EVENT, { detail: { query } }));
}

/** Single-key shortcuts must not fire while typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

/** J/K/⏎/H/R/E → commands (Inbox A). Null for anything else. */
export function commandForKey(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">): OsCommand | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  switch (e.key) {
    case "j":
    case "J":
      return "next";
    case "k":
    case "K":
      return "prev";
    case "Enter":
      return "approve";
    case "h":
    case "H":
      return "hold";
    case "r":
    case "R":
      return "regenerate";
    case "e":
    case "E":
      return "focus-draft";
    default:
      return null;
  }
}
