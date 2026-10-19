"use client";

// Which draft the Inspect drawer shows. The composer opens it (button or I),
// the contact panel's slot shows it in place of the panel, Esc closes it.
// A tiny module store, so the conversation pane and the panel pane (separate
// trees) share it without importing each other.

import { useSyncExternalStore } from "react";

export type InspectRequest = { draftId: string };

let current: InspectRequest | null = null;
const subs = new Set<() => void>();

function set(next: InspectRequest | null) {
  current = next;
  for (const s of subs) s();
}

export const currentInspect = () => current;
export const openInspect = (draftId: string) => set({ draftId });
export const closeInspect = () => set(null);
export function toggleInspect(draftId: string) {
  set(current?.draftId === draftId ? null : { draftId });
}

function subscribe(fn: () => void) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function useInspect(): InspectRequest | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null
  );
}
