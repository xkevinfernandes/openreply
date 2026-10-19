"use client";

// The contact panel's left edge: drag it (or focus it and use ← / →, Home,
// End) to change the panel width. One width for the Inbox and Contacts, set
// as --os-panel-w on the .os root and kept in a cookie + localStorage.

import { useEffect, useRef, useState } from "react";
import {
  clampPanelWidth,
  PANEL_DEFAULT,
  PANEL_MAX,
  PANEL_MIN,
  PANEL_STEP,
  PANEL_WIDTH_KEY,
  panelWidthCookie,
  parsePanelWidth,
} from "@/lib/os/contact-panel/width";

function root(el: HTMLElement | null): HTMLElement | null {
  return el?.closest<HTMLElement>(".os") ?? null;
}

function current(el: HTMLElement | null): number {
  const v = root(el)?.style.getPropertyValue("--os-panel-w");
  return parsePanelWidth(v ? v.replace("px", "") : null);
}

function apply(el: HTMLElement | null, w: number) {
  root(el)?.style.setProperty("--os-panel-w", `${w}px`);
}

function save(w: number) {
  document.cookie = panelWidthCookie(w);
  try {
    localStorage.setItem(PANEL_WIDTH_KEY, String(w));
  } catch {
    /* private mode: the cookie is enough */
  }
}

export default function PanelResizer({ label = "Resize contact panel" }: { label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>(PANEL_DEFAULT);
  const [dragging, setDragging] = useState(false);

  // The cookie already set the width on the server; localStorage wins if the
  // cookie was cleared.
  useEffect(() => {
    const el = ref.current;
    let w = current(el);
    try {
      const stored = localStorage.getItem(PANEL_WIDTH_KEY);
      if (stored && !document.cookie.includes("os_panel_w=")) {
        w = parsePanelWidth(stored);
        apply(el, w);
        save(w);
      }
    } catch {
      /* ignore */
    }
    setWidth(w);
  }, []);

  function set(w: number, persist = true) {
    const next = clampPanelWidth(w);
    apply(ref.current, next);
    setWidth(next);
    if (persist) save(next);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* no active pointer (synthetic event): moves still reach the handle */
    }
    const startX = e.clientX;
    const startW = current(el);
    let last = startW;
    setDragging(true);
    document.documentElement.dataset.osResizing = "true";

    const move = (ev: PointerEvent) => {
      // The panel sits on the right: dragging left makes it wider.
      last = clampPanelWidth(startW + (startX - ev.clientX));
      apply(el, last);
      setWidth(last);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      delete document.documentElement.dataset.osResizing;
      setDragging(false);
      save(last);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? PANEL_STEP * 4 : PANEL_STEP;
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = width + step;
    else if (e.key === "ArrowRight") next = width - step;
    else if (e.key === "Home") next = PANEL_MIN;
    else if (e.key === "End") next = PANEL_MAX;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    set(next);
  }

  return (
    <div
      ref={ref}
      className="os-panel-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={PANEL_MIN}
      aria-valuemax={PANEL_MAX}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      data-dragging={dragging ? "true" : undefined}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => set(PANEL_DEFAULT)}
    />
  );
}
