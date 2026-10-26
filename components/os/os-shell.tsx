"use client";

// The DM OS shell (Sidebar board): no top bar. "DM OS" and the account sit at
// the top of the sidebar with the collapse toggle and the ⌘K field; 7 nav
// items with counts; the foot holds the mode, Pause all and J's sends today
// against the daily setter send limit (links to Settings › Workspace).
// Collapsed, it is a 64px icon rail (cookie os_sidebar=rail, read by the
// layout so the first paint is right); a hovered rail row grows out into an
// ink pill with its name (reel.css). Phones get a frosted header: the
// account row, then every page as one swipeable pill row; the menu button
// opens the drawer for the rest (sends, Pause all, theme).

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { setPauseAll } from "@/app/(os)/os/actions";
import { openPalette } from "@/components/os/keys";
import PaletteMount from "@/components/os/palette/mount";
import { settingsHref } from "@/lib/os/settings";
import { useScrollPicked } from "@/components/os/ui/scroll-picked";
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
const SUN = "M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.85.85M11.75 11.75l.85.85M3.4 12.6l.85-.85M11.75 4.25l.85-.85M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z";
const MOON = "M13.5 9.6A5.6 5.6 0 0 1 6.4 2.5a5.6 5.6 0 1 0 7.1 7.1Z";
const AUTO = "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2Zm0 0v12";

type Theme = "auto" | "light" | "dark";
const THEME_NEXT: Record<Theme, Theme> = { auto: "light", light: "dark", dark: "auto" };
const THEME_LABEL: Record<Theme, string> = { auto: "Auto theme", light: "Light theme", dark: "Dark theme" };
const THEME_ICON: Record<Theme, string> = { auto: AUTO, light: SUN, dark: MOON };

function readTheme(): Theme {
  try {
    const t = localStorage.getItem("theme");
    return t === "light" || t === "dark" ? t : "auto";
  } catch {
    return "auto";
  }
}

// The pick lives outside React (localStorage, shared with ContentOS and the
// portal); the shell subscribes to it. The server always renders "auto".
const themeListeners = new Set<() => void>();
function subscribeTheme(cb: () => void) {
  themeListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    themeListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
const serverTheme = (): Theme => "auto";

/** Auto → Light → Dark, kept in localStorage.theme (shared with ContentOS). */
function applyTheme(t: Theme) {
  try {
    if (t === "auto") localStorage.removeItem("theme");
    else localStorage.setItem("theme", t);
  } catch {}
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  themeListeners.forEach((cb) => cb());
}

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
  const theme = useSyncExternalStore(subscribeTheme, readTheme, serverTheme);
  const menuRef = useRef<HTMLButtonElement>(null);
  const barNavRef = useRef<HTMLElement>(null);
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

  // Phone pill row: keep the current page's pill in view and fade only
  // the edges with more behind them.
  useScrollPicked(barNavRef, current?.key);

  function toggleRail() {
    const next: SidebarMode = rail ? "full" : "rail";
    setMode(next);
    document.cookie = sidebarCookie(next);
  }

  function cycleTheme() {
    applyTheme(THEME_NEXT[theme]);
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
        <div className="os-bar-top">
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
          <span className="os-bar-here">{handle}</span>
        </div>
        <nav ref={barNavRef} className="os-bar-nav" aria-label="Pages">
          {osNav.map((item) => {
            const n = BADGED.has(item.key) ? (counts[item.key] ?? 0) : 0;
            return (
              <Link key={item.key} href={item.href} className="os-bar-pill" aria-current={current?.key === item.key ? "page" : undefined}>
                {item.label}
                {n ? (
                  <span className="n" data-tone={item.key === "inbox" ? "warn" : undefined} aria-label={badgeLabel(item.key, n)}>
                    {n}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
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
                  data-label={railLabel}
                >
                  <Icon d={item.icon} />
                  <span className="lbl">{item.label}</span>
                  {n ? (
                    <span className="n" data-tone={item.key === "inbox" ? "warn" : undefined} aria-label={badgeLabel(item.key, n)}>
                      {n}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <div className="os-side-foot" title={rail ? `${modeLabel} · ${sends.sentToday} / ${sends.cap} setter sends today` : undefined}>
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
            <Link
              href={`${settingsHref("workspace")}#os-set-sending`}
              className="os-side-sends"
              title="J's sends today against the daily setter send limit. Workflows, openers and your own replies don't count. Change the limit in Settings."
            >
              <span className="os-side-sends-label">Setter sends today</span>
              <span className="os-side-sends-n">
                {sends.sentToday}
                <span className="os-side-sends-cap"> / {sends.cap}</span>
              </span>
            </Link>
            <div className="os-side-meter" aria-hidden="true">
              <div style={{ width: `${pct}%` }} data-full={pct >= 100 || undefined} />
            </div>
            {error ? (
              <p className="os-side-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <button type="button" className="os-side-theme" onClick={cycleTheme} aria-label={`${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[THEME_NEXT[theme]].toLowerCase()}`} title={rail ? THEME_LABEL[theme] : undefined}>
            <Icon d={THEME_ICON[theme]} />
            <span className="os-side-theme-text">{THEME_LABEL[theme]}</span>
          </button>
        </aside>

        <main className="os-main">{children}</main>
      </div>
      <PaletteMount />
    </div>
  );
}
