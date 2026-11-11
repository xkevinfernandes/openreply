"use client";

import Link from "next/link";
import { Tabs as CpTabs, type TabLinkProps } from "@claudepreneur/brand/react";

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

const NextLink = ({ href, className, children, ...rest }: TabLinkProps) => (
  <Link href={href} className={className} {...rest}>
    {children}
  </Link>
);

/** Tab row: the shared Tabs (@claudepreneur/brand), an ink pill on a track
 * (--card on the stone, --well in a card). Follow-ups, Automations,
 * broadcasts, the contact panel. Same props as before. */
export function Tabs({ tabs, value, ariaLabel, onChange, hrefFor, size = "md" }: TabsProps) {
  return (
    <CpTabs
      label={ariaLabel}
      value={value}
      onChange={onChange}
      linkComponent={hrefFor ? NextLink : undefined}
      className={`os-tabs${size === "sm" ? " is-sm" : ""}`}
      tabs={tabs.map((t) => ({ value: t.key, label: t.label, count: t.count ? t.count : undefined, href: hrefFor?.(t.key) }))}
    />
  );
}
