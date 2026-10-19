import Link from "next/link";

export type AutomationsTab = "workflows" | "campaigns" | "broadcasts";

const TABS: { key: AutomationsTab; label: string; href: string }[] = [
  // Workflows first; Campaigns stay until each is rebuilt as a workflow (C3).
  { key: "workflows", label: "Workflows", href: "/os/automations/workflows" },
  { key: "campaigns", label: "Campaigns", href: "/os/automations" },
  // The broadcasts screens are S5's (app/(os)/os/automations/broadcasts).
  { key: "broadcasts", label: "Broadcasts", href: "/os/automations/broadcasts" },
];

/** Workflows · Campaigns · Broadcasts (WorkflowsList board). Line tests live in Knowledge bases › Tests. */
export function AutomationsTabs({ active, counts }: { active: AutomationsTab; counts?: Partial<Record<AutomationsTab, number>> }) {
  return (
    <nav className="os-tabs os-auto-tabs" aria-label="Automation types">
      {TABS.map((t) => (
        <Link key={t.key} href={t.href} className="os-tab" aria-current={t.key === active ? "page" : undefined} aria-selected={t.key === active}>
          {t.label}
          {counts?.[t.key] !== undefined ? <span className="os-auto-tab-n">{counts[t.key]}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
