// The DM OS left nav. Order and labels come from the build spec
// (DM Setter docs/sp/dms/2026-10-18-dm-os-spec.md).

export const OS_BASE = "/os";

export const osNav = [
  { label: "Home", href: OS_BASE },
  { label: "Automations", href: `${OS_BASE}/automations` },
  { label: "Inbox", href: `${OS_BASE}/inbox` },
  { label: "Contacts", href: `${OS_BASE}/contacts` },
  { label: "Follow-ups", href: `${OS_BASE}/follow-ups` },
  { label: "Knowledge bases", href: `${OS_BASE}/knowledge` },
  { label: "Integrations", href: `${OS_BASE}/integrations` },
  { label: "Settings", href: `${OS_BASE}/settings` },
] as const;

export function isActive(pathname: string, href: string): boolean {
  if (href === OS_BASE) return pathname === OS_BASE;
  return pathname === href || pathname.startsWith(href + "/");
}
