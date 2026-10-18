"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { isActive, osNav } from "@/lib/os/nav";

interface OsShellProps {
  workspaceName: string;
  instagramUsername: string | null;
  children: React.ReactNode;
}

export default function OsShell({ workspaceName, instagramUsername, children }: OsShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="os-topbar">
        <button
          type="button"
          className="os-menu-button"
          aria-label="Open menu"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        </button>
        DM OS
      </div>

      {open && <div className="os-scrim" onClick={() => setOpen(false)} />}

      <aside className="os-sidebar" data-open={open}>
        <div className="os-brand">
          DM OS
          <small>{instagramUsername ? `@${instagramUsername}` : workspaceName}</small>
        </div>
        <nav className="os-nav" aria-label="Main">
          {osNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              aria-current={isActive(pathname, item.href) ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="os-sidebar-foot">
          {workspaceName} · <Link href="/dashboard">Old dashboard</Link>
        </div>
      </aside>

      <main className="os-main">{children}</main>
    </>
  );
}
