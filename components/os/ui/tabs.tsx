"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

export interface TabItem {
  key: string;
  label: string;
  count?: number | null;
}

interface TabsProps {
  tabs: readonly TabItem[];
  value: string;
  ariaLabel: string;
  /** Buttons (client state) when set… */
  onChange?: (key: string) => void;
  /** …or links (URL state, e.g. ?tab=). */
  hrefFor?: (key: string) => string;
  size?: "sm" | "md";
}

/** Tab row: a pill track (--card on the stone, --well in a card), the picked
 * tab an ink pill. Follow-ups, Automations, broadcasts, the contact panel. */
export function Tabs({ tabs, value, ariaLabel, onChange, hrefFor, size = "md" }: TabsProps) {
  const row = useRef<HTMLDivElement>(null);

  // A row wider than its column scrolls inside the track (never the page).
  // Keep the picked tab in view, and mark which edges have more tabs past
  // them so the CSS can fade that edge (data-fade="start|end|both").
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const mark = () => {
      const more = el.scrollWidth - el.clientWidth;
      const start = el.scrollLeft > 1;
      const end = more > 1 && el.scrollLeft < more - 1;
      const fade = start && end ? "both" : start ? "start" : end ? "end" : "";
      if (fade) el.dataset.fade = fade;
      else delete el.dataset.fade;
    };
    const on = el.querySelector<HTMLElement>('[aria-selected="true"]');
    if (on && el.scrollWidth > el.clientWidth) {
      const left = on.offsetLeft - el.offsetLeft;
      const right = left + on.offsetWidth;
      if (left < el.scrollLeft || right > el.scrollLeft + el.clientWidth) {
        el.scrollLeft = Math.max(0, right - el.clientWidth + 24);
      }
    }
    mark();
    el.addEventListener("scroll", mark, { passive: true });
    const ro = new ResizeObserver(mark);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", mark);
      ro.disconnect();
    };
  }, [value, tabs.length]);

  return (
    <div ref={row} className="os-tabs" role="tablist" aria-label={ariaLabel} data-size={size}>
      {tabs.map((t) => {
        const selected = t.key === value;
        const inner = (
          <>
            {t.label}
            {t.count ? <span className="os-tabs-n">{t.count}</span> : null}
          </>
        );
        return hrefFor ? (
          <Link key={t.key} href={hrefFor(t.key)} role="tab" aria-selected={selected} className="os-tab">
            {inner}
          </Link>
        ) : (
          <button key={t.key} type="button" role="tab" aria-selected={selected} className="os-tab" onClick={() => onChange?.(t.key)}>
            {inner}
          </button>
        );
      })}
    </div>
  );
}
