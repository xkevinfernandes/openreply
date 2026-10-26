"use client";

import { useEffect, type RefObject } from "react";

/** How far the picked pill sits from an edge, so it starts clear of the fade. */
const CLEAR = 32;

/** Rows already placed once: a later pick on the same row may glide. */
const placed = new WeakSet<HTMLElement>();

/**
 * On a phone, some rows of pills scroll sideways: the shell's page row, the
 * settings tabs and the knowledge tree. This keeps the picked pill
 * (`aria-current="page"`) in view by scrolling the row itself, never the
 * page, so the pill sits clear of both edge fades. The first pass on mount
 * is instant; a later change of `pick` (a route change) glides, unless the
 * viewer prefers reduced motion.
 *
 * It also marks which ends of the row have more behind them
 * (`data-more="left" | "right" | "both"`, absent when everything fits), so
 * the CSS fades only those edges.
 */
export function useScrollPicked(row: string | RefObject<HTMLElement | null>, pick?: string) {
  useEffect(() => {
    const el = typeof row === "string" ? document.querySelector<HTMLElement>(row) : row.current;
    return el ? placeRow(el) : undefined;
  }, [row, pick]);
}

/** Scrolls the picked pill into view and keeps `data-more` current; returns the cleanup. */
function placeRow(el: HTMLElement): () => void {
  const mark = () => {
    const max = el.scrollWidth - el.clientWidth;
    const left = el.scrollLeft > 1;
    const right = max - el.scrollLeft > 1;
    const more = left && right ? "both" : left ? "left" : right ? "right" : "";
    if (more) el.dataset.more = more;
    else delete el.dataset.more;
  };

  if (el.scrollWidth > el.clientWidth) {
    const on = el.querySelector<HTMLElement>('[aria-current="page"]');
    if (on) {
      const start = on.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft;
      const end = start + on.offsetWidth;
      const hidden = start - CLEAR < el.scrollLeft || end + CLEAR > el.scrollLeft + el.clientWidth;
      if (hidden) {
        const target = Math.max(0, Math.min(start - CLEAR, el.scrollWidth - el.clientWidth));
        const first = !placed.has(el);
        const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollTo({ left: target, behavior: first || still ? "instant" : "smooth" });
      }
    }
  }
  placed.add(el);

  mark();
  el.addEventListener("scroll", mark, { passive: true });
  window.addEventListener("resize", mark);
  return () => {
    el.removeEventListener("scroll", mark);
    window.removeEventListener("resize", mark);
  };
}

/** `useScrollPicked` as a component, for server pages: renders nothing. */
export function ScrollPicked({ row, pick }: { row: string; pick?: string }) {
  useScrollPicked(row, pick);
  return null;
}
