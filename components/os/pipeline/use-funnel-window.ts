"use client";

// The 7/30/90 switch Home's funnel and the All · funnel board share: one
// stored value per browser (WINDOW_KEY = crm-funnel FUNNEL_WINDOW_KEY), so changing it on either
// changes both, also across open tabs.

import { useCallback, useSyncExternalStore } from "react";
import type { FunnelWindow } from "@/lib/os/crm-funnel";
import { DEFAULT_WINDOW, parseWindow, WINDOW_KEY } from "@/lib/os/home-funnel-view";

const EVENT = "os-funnel-window";
/** When storage is blocked, the switch still works for this page. */
let memo: FunnelWindow | null = null;

function read(): FunnelWindow {
  try {
    return parseWindow(window.localStorage.getItem(WINDOW_KEY));
  } catch {
    return memo ?? DEFAULT_WINDOW;
  }
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === WINDOW_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(EVENT, cb);
  };
}

export function useFunnelWindow(): [FunnelWindow, (w: FunnelWindow) => void] {
  const value = useSyncExternalStore(subscribe, read, () => DEFAULT_WINDOW);
  const set = useCallback((w: FunnelWindow) => {
    memo = w;
    try {
      window.localStorage.setItem(WINDOW_KEY, String(w));
    } catch {
      /* blocked storage: memo above */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [value, set];
}
