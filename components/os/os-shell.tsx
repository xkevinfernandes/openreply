"use client";

// The DM OS shell (Sidebar board): no top bar. "DM OS" and the account sit at
// the top of the sidebar with the collapse toggle and the ⌘K field; 7 nav
// items with counts; the foot holds the mode, Pause all and today's sends.
// Collapsed, it is a 64px icon rail (cookie os_sidebar=rail, read by the
// layout so the first paint is right). Phones get a drawer behind a small bar.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { setPauseAll } from "@/app/(os)/os/actions";
import { openPalette } from "@/components/os/keys";
import PaletteMount from "@/components/os/palette/mount";
import { activeNav, BADGED, badgeLabel, isActive, osNav, sidebarCookie, type NavItem, type SidebarMode } from "@/lib/os/nav";

export interface ShellSends {
  sentToday: number;
  cap: number;
  pausedAll: boolean;
}

interface OsShellProps {
  workspaceName: string;
  instagramUsername: string | null;
  /** Counts by nav key: inbox = drafts waiting, followups = due. */
  counts?: Partial<Record<NavItem["key"], number>>;
  sends: ShellSends;
  sidebar: SidebarMode;
  children: React.ReactNode;
}

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    <path d={d} />
  </svg>
);

const COLLAPSE = "M2 4a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 14 4v8a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12V4ZM6 2.5v11M10.5 6.2 8.8 8l1.7 1.8";
const EXPAND = "M2 4a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 14 4v8a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12V4ZM6 2.5v11M9 6.2 10.7 8 9 9.8";
const SEARCH = "M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM10.5 10.5l3 3";
const PAUSE = "M5.5 3.5v9M10.5 3.5v9";
const PLAY = "M5 3.2v9.6L12.5 8 5 3.2Z";
const MENU = "M2.5 4.5h11M2.5 8h11M2.5 11.5h11";

export default function OsShell({ workspaceName, instagramUsername, counts = {}, sends, sidebar, children }: OsShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mode, setMode] = useState<SidebarMode>(sidebar);
  const [open, setOpen] = useState(false);
  // Optimistic Pause all until the server value comes back with the refresh.
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const paused = optimistic ?? sends.pausedAll;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const rail = mode === "rail";
  const handle = instagramUsername ? `@${instagramUsername}` : workspaceName;
  const current = activeNav(pathname);

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

  function toggleRail() {
    const next: SidebarMode = rail ? "full" : "rail";
    setMode(next);
    document.cookie = sidebarCookie(next);
  }

  function togglePause() {
    const next = !paused;
    setError(null);
    setOptimistic(next);
    startTransition(async () => {
      const r = await setPauseAll(next);
      if ("error" in r) setError(r.error);
      router.refresh();
      setOptimistic(null);
    });
  }

  const pct = sends.cap > 0 ? Math.min(100, (sends.sentToday / sends.cap) * 100) : 0;
  const modeLabel = paused ? "Paused" : "Approve-only";
  const pauseLabel = paused ? "Resume sending" : "Kill switch: pause all sending";

  return (
    <div className="os-shell" data-sidebar={mode}>
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
          <Icon d={MENU} size={18} />
        </button>
        <Link href="/os" className="os-bar-home">
          DM OS
        </Link>
        {current && current.href !== "/os" ? <span className="os-bar-here">{current.label}</span> : null}
      </header>

      <div className="os-frame">
        <div className="os-scrim" data-open={open} aria-hidden="true" onClick={() => setOpen(false)} />

        <aside id="os-sidebar" ref={sidebarRef} className="os-sidebar" data-open={open} data-mode={mode} aria-label="DM OS">
          <div className="os-side-head">
            <span className="os-logo" title={rail ? `DM OS · ${handle}` : undefined} aria-hidden={rail ? undefined : true}>
              DM
            </span>
            <div className="os-side-id">
              <span className="os-side-name">DM OS</span>
              <span className="os-side-handle">{handle}</span>
            </div>
            <button type="button" className="os-side-toggle" aria-label={rail ? "Expand sidebar" : "Collapse sidebar"} title={rail ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!rail} onClick={toggleRail}>
              <Icon d={rail ? EXPAND : COLLAPSE} />
            </button>
          </div>

          <button type="button" className="os-side-search" aria-label="Search or jump to (⌘K)" title={rail ? "Search · ⌘K" : undefined} onClick={() => openPalette()}>
            <Icon d={SEARCH} size={14} />
            <span className="os-side-search-text">Search or jump to…</span>
            <span className="os-side-search-kbd">⌘K</span>
          </button>

          <nav className="os-nav" aria-label="Main">
            {osNav.map((item) => {
              const n = BADGED.has(item.key) ? (counts[item.key] ?? 0) : 0;
              const railLabel = n ? `${item.label} · ${n}` : item.label;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive(pathname, item.href) ? "page" : undefined}
                  aria-label={rail ? railLabel : undefined}
                  title={rail ? railLabel : undefined}
                >
                  <Icon d={item.icon} />
                  <span className="lbl">{item.label}</span>
                  {n ? (
                    <span className="n" aria-label={badgeLabel(item.key, n)}>
                      {n}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <div className="os-side-foot" title={rail ? `${modeLabel} · ${sends.sentToday} / ${sends.cap} sends today` : undefined}>
            <div className="os-side-mode">
              <span className="os-side-status">
                <span className="os-dot" data-tone={paused ? "warn" : "mark"} role="img" aria-label={modeLabel} />
                <span className="os-side-status-text">{modeLabel}</span>
              </span>
              <button type="button" className="os-side-pause" aria-label={pauseLabel} title={rail ? (paused ? "Resume" : "Pause all") : undefined} aria-pressed={paused} disabled={pending} onClick={togglePause}>
                <Icon d={paused ? PLAY : PAUSE} size={12} />
                <span className="os-side-pause-text">{paused ? "Resume" : "Pause all"}</span>
              </button>
            </div>
            <div className="os-side-sends">
              <span className="os-side-sends-label">Sends today</span>
              <span className="os-side-sends-n">
                {sends.sentToday}
                <span className="os-side-sends-cap"> / {sends.cap}</span>
              </span>
            </div>
            <div className="os-side-meter" aria-hidden="true">
              <div style={{ width: `${pct}%` }} data-full={pct >= 100 || undefined} />
            </div>
            {error ? (
              <p className="os-side-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </aside>

        <main className="os-main">{children}</main>
      </div>
      <PaletteMount />
    </div>
  );
}
