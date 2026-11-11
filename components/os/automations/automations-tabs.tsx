"use client";

import Link from "next/link";
import { Tabs, type TabLinkProps } from "@claudepreneur/brand/react";

const NextLink = ({ href, className, children, ...rest }: TabLinkProps) => (
  <Link href={href} className={className} {...rest}>
    {children}
  </Link>
);

export type AutomationsTab = "workflows" | "campaigns" | "broadcasts";

const TABS: { key: AutomationsTab; label: string; href: string }[] = [
  // Workflows first; Campaigns stay until each is rebuilt as a workflow (C3).
  { key: "workflows", label: "Workflows", href: "/os/automations/workflows" },
  { key: "campaigns", label: "Campaigns", href: "/os/automations" },
  // The broadcasts screens are S5's (app/(os)/os/automations/broadcasts).
  { key: "broadcasts", label: "Broadcasts", href: "/os/automations/broadcasts" },
];

/** Workflows · Campaigns · Broadcasts (WorkflowsList board), the shared Tabs in link mode. Line tests live in Knowledge bases › Tests. */
export function AutomationsTabs({ active, counts }: { active: AutomationsTab; counts?: Partial<Record<AutomationsTab, number>> }) {
  return (
    <Tabs
      label="Automation types"
      className="os-tabs os-auto-tabs"
      value={active}
      linkComponent={NextLink}
      tabs={TABS.map((t) => ({ value: t.key, label: t.label, href: t.href, count: counts?.[t.key] }))}
    />
  );
}
