"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { isActive, osNav } from "@/lib/os/nav";

interface OsShellProps {
  workspaceName: string;
  instagramUsername: string | null;
  /** Sidebar counts by href (drafts waiting, contacts, setters). */
  counts?: Record<string, number>;
  children: React.ReactNode;
}

// The left nav in groups, Review Room style. Order stays the spec's (lib/os/nav.ts).
const GROUPS: { title: string | null; hrefs: string[] }[] = [
  { title: null, hrefs: ["/os"] },
  { title: "Pipeline", hrefs: ["/os/automations", "/os/inbox", "/os/contacts", "/os/follow-ups"] },
  { title: "Setup", hrefs: ["/os/knowledge", "/os/integrations", "/os/settings"] },
];
// Anything added to the nav later and not grouped above still shows, at the end.
const grouped = new Set(GROUPS.flatMap((g) => g.hrefs));
const rest = osNav.filter((n) => !grouped.has(n.href)).map((n) => n.href as string);
const NAV_GROUPS = rest.length ? [...GROUPS, { title: null, hrefs: rest }] : GROUPS;

const ICONS: Record<string, React.ReactNode> = {
  "/os": <path d="M2.5 7.2 8 2.8l5.5 4.4V13a.5.5 0 0 1-.5.5H10V10H6v3.5H3a.5.5 0 0 1-.5-.5V7.2Z" />,
  "/os/automations": <path d="M9 1.8 3.5 9H8l-1 5.2L12.5 7H8l1-5.2Z" />,
  "/os/inbox": (
    <>
      <path d="M2 9.5 3.6 3.4a1 1 0 0 1 1-.9h6.8a1 1 0 0 1 1 .9L14 9.5V13a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 2 13V9.5Z" />
      <path d="M2 9.5h3.5l.8 1.5h3.4l.8-1.5H14" />
    </>
  ),
  "/os/contacts": (
    <>
      <circle cx="6" cy="5.5" r="2.5" />
      <path d="M1.8 13.5c.4-2.4 2.1-3.8 4.2-3.8s3.8 1.4 4.2 3.8M10.5 3.2a2.4 2.4 0 0 1 0 4.6M12 9.9c1.2.5 2 1.7 2.2 3.6" />
    </>
  ),
  "/os/follow-ups": (
    <>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 4.8V8l2.2 1.4" />
    </>
  ),
  "/os/knowledge": (
    <>
      <path d="M3 2.5h7.5a1 1 0 0 1 1 1v10H4a1 1 0 0 1-1-1v-10Z" />
      <path d="M3 11.5a1 1 0 0 1 1-1h7.5M6 5.5h3" />
    </>
  ),
  "/os/integrations": <path d="M6 2.5v3M10 2.5v3M4.5 5.5h7v2.8a3.5 3.5 0 0 1-7 0V5.5ZM8 11.8v2" />,
  "/os/settings": (
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.8v1.8M8 12.4v1.8M1.8 8h1.8M12.4 8h1.8M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M3.6 12.4l1.3-1.3M11.1 4.9l1.3-1.3" />
    </>
  ),
};

export default function OsShell({ workspaceName, instagramUsername, counts = {}, children }: OsShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const current = osNav.find((item) => isActive(pathname, item.href));

  // Phone drawer: Escape closes it, focus goes in on open and back on close.
  useEffect(() => {
    if (!open) return;
    sidebarRef.current?.querySelector<HTMLElement>("a")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        menuRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <header className="os-bar">
        <button
          ref={menuRef}
          type="button"
          className="os-menu-button"
          aria-label="Open menu"
          aria-expanded={open}
          aria-controls="os-sidebar"
          onClick={() => setOpen(true)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
          </svg>
        </button>
        <nav className="os-crumb" aria-label="Breadcrumb">
          <Link href="/os" className="os-crumb-home">
            DM OS
          </Link>
          {current && current.href !== "/os" && (
            <>
              <span aria-hidden="true">/</span>
              <Link href={current.href} aria-current="page" className="os-crumb-here">
                {current.label}
              </Link>
            </>
          )}
        </nav>
        {instagramUsername && (
          <a className="os-bar-account" href={`https://instagram.com/${instagramUsername}`} target="_blank" rel="noreferrer">
            @{instagramUsername}
          </a>
        )}
      </header>

      <div className="os-frame">
        <div className="os-scrim" data-open={open} aria-hidden="true" onClick={() => setOpen(false)} />

        <aside id="os-sidebar" ref={sidebarRef} className="os-sidebar" data-open={open} aria-label="Main">
          <nav className="os-nav">
            {NAV_GROUPS.map((group) => (
              <div className="os-nav-group" key={group.hrefs[0]}>
                {group.title && <h4>{group.title}</h4>}
                {group.hrefs.map((href) => {
                  const item = osNav.find((n) => n.href === href);
                  if (!item) return null;
                  const n = counts[href];
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setOpen(false)}
                      aria-current={isActive(pathname, href) ? "page" : undefined}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        {ICONS[href]}
                      </svg>
                      <span className="lbl">{item.label}</span>
                      {n ? (
                        <span className="n" aria-label={href === "/os/inbox" ? `${n} drafts waiting` : href === "/os/follow-ups" ? `${n} follow-ups due` : undefined}>
                          {n}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="os-sidebar-foot">
            <span>{workspaceName}</span>
            <Link href="/dashboard">Old dashboard</Link>
          </div>
        </aside>

        <main className="os-main">{children}</main>
      </div>
    </>
  );
}
