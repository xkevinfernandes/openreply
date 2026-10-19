import Link from "next/link";

/** Campaigns | Experiments, inside Automations (the spec keeps the left nav as is). */
export function AutomationsTabs({ active }: { active: "campaigns" | "experiments" }) {
  return (
    <nav className="os-kb-tabs os-auto-tabs" aria-label="Automations">
      <Link href="/os/automations" aria-current={active === "campaigns" ? "page" : undefined}>
        Campaigns
      </Link>
      <Link href="/os/automations/experiments" aria-current={active === "experiments" ? "page" : undefined}>
        Experiments
      </Link>
    </nav>
  );
}
