// The DM OS left nav: 7 items, in the order of the UI spec
// (DM Setter docs/sp/dms/2026-10-19-dm-os-ui-spec.md "Nav"). Integrations
// lives inside Settings, so /os/integrations lights up Settings.

export const OS_BASE = "/os";

export interface NavItem {
  key: "home" | "inbox" | "contacts" | "followups" | "automations" | "knowledge" | "settings";
  label: string;
  href: string;
  /** 16×16 stroke icon path (Sidebar board). */
  icon: string;
  /** Other paths that belong to this item. */
  also?: string[];
}

export const osNav: readonly NavItem[] = [
  { key: "home", label: "Home", href: OS_BASE, icon: "M2.5 7.2 8 2.8l5.5 4.4V13a.5.5 0 0 1-.5.5H10V10H6v3.5H3a.5.5 0 0 1-.5-.5V7.2Z" },
  { key: "inbox", label: "Inbox", href: `${OS_BASE}/inbox`, icon: "M2 9.5 3.6 3.4a1 1 0 0 1 1-.9h6.8a1 1 0 0 1 1 .9L14 9.5V13a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 2 13V9.5ZM2 9.5h3.5l.8 1.5h3.4l.8-1.5H14" },
  { key: "contacts", label: "Contacts", href: `${OS_BASE}/contacts`, icon: "M6 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.8 13.5c.4-2.4 2.1-3.8 4.2-3.8s3.8 1.4 4.2 3.8M10.5 3.2a2.4 2.4 0 0 1 0 4.6M12 9.9c1.2.5 2 1.7 2.2 3.6" },
  { key: "followups", label: "Follow-ups", href: `${OS_BASE}/follow-ups`, icon: "M8 13.8A5.8 5.8 0 1 0 8 2.2a5.8 5.8 0 0 0 0 11.6ZM8 4.8V8l2.2 1.4" },
  { key: "automations", label: "Automations", href: `${OS_BASE}/automations`, icon: "M9 1.8 3.5 9H8l-1 5.2L12.5 7H8l1-5.2Z" },
  { key: "knowledge", label: "Knowledge bases", href: `${OS_BASE}/knowledge`, icon: "M3 2.5h7.5a1 1 0 0 1 1 1v10H4a1 1 0 0 1-1-1v-10ZM3 11.5a1 1 0 0 1 1-1h7.5M6 5.5h3" },
  {
    key: "settings",
    label: "Settings",
    href: `${OS_BASE}/settings`,
    also: [`${OS_BASE}/integrations`],
    icon: "M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 1.8v1.8M8 12.4v1.8M1.8 8h1.8M12.4 8h1.8M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M3.6 12.4l1.3-1.3M11.1 4.9l1.3-1.3",
  },
];

function under(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

export function isActive(pathname: string, href: string): boolean {
  if (href === OS_BASE) return pathname === OS_BASE;
  const item = osNav.find((n) => n.href === href);
  return under(pathname, href) || !!item?.also?.some((p) => under(pathname, p));
}

export function activeNav(pathname: string): NavItem | null {
  return osNav.find((n) => isActive(pathname, n.href)) ?? null;
}

/** Nav items that show a count: drafts waiting, follow-ups due. */
export const BADGED: ReadonlySet<NavItem["key"]> = new Set(["inbox", "followups"]);

export function badgeLabel(key: NavItem["key"], n: number): string | undefined {
  if (key === "inbox") return `${n} drafts waiting`;
  if (key === "followups") return `${n} follow-ups due`;
  return undefined;
}

// --- Sidebar rail -------------------------------------------------------------
// Collapsed to a 64px icon rail, remembered per browser in a cookie the layout
// reads on the server (no flash of the wrong width).

export const SIDEBAR_COOKIE = "os_sidebar";
export type SidebarMode = "full" | "rail";

export function parseSidebarCookie(v: string | null | undefined): SidebarMode {
  return v === "rail" ? "rail" : "full";
}

/** document.cookie string for the choice (one year, whole app). */
export function sidebarCookie(mode: SidebarMode): string {
  return `${SIDEBAR_COOKIE}=${mode}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
