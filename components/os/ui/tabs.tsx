"use client";

import Link from "next/link";

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

/** Underlined tab row (Inbox categories, panel tabs, Settings sub-nav). */
export function Tabs({ tabs, value, ariaLabel, onChange, hrefFor, size = "md" }: TabsProps) {
  return (
    <div className="os-tabs" role="tablist" aria-label={ariaLabel} data-size={size}>
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
