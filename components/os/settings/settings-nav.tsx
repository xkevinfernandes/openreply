"use client";

// Settings' section list: one card of rows (name + one status line), the
// picked row in --well, like the inbox thread list. Lines that took longer
// than 1.5 s on the server arrive here as "…" and are fetched after render.

import Link from "next/link";
import { useEffect, useState } from "react";
import { STATUS_PENDING, type SettingsTab } from "@/lib/os/settings";

export interface SettingsNavItem {
  tab: SettingsTab;
  label: string;
  href: string;
  line: string;
}

/** The server's line, unless it was too slow ("…") and the client fetched it. */
export function lineOf(item: Pick<SettingsNavItem, "tab" | "line">, fetched: Record<string, string>): string {
  return item.line === STATUS_PENDING ? (fetched[item.tab] ?? item.line) : item.line;
}

export default function SettingsNav({ items, current }: { items: SettingsNavItem[]; current: SettingsTab | null }) {
  // Only the lines fetched here; a fresh server line (after a save) always wins.
  const [lines, setLines] = useState<Record<string, string>>({});
  const pending = items.filter((i) => i.line === STATUS_PENDING).map((i) => i.tab).join(",");

  useEffect(() => {
    if (!pending) return;
    let live = true;
    fetch(`/api/os/settings-status?tabs=${pending}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((p) => {
        if (live && p?.success) setLines((l) => ({ ...l, ...p.data }));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [pending]);

  return (
    <nav className="os-sx-nav" aria-label="Settings sections">
      {items.map((i) => (
        <Link key={i.tab} href={i.href} aria-current={current === i.tab ? "page" : undefined} className="os-sx-row">
          <span className="os-sx-row-name">{i.label}</span>
          <span className="os-sx-row-line" aria-busy={lineOf(i, lines) === STATUS_PENDING || undefined}>
            {lineOf(i, lines)}
          </span>
          <svg viewBox="0 0 16 16" aria-hidden="true" className="os-sx-row-chev">
            <path d="m6 3.5 4.5 4.5L6 12.5" />
          </svg>
        </Link>
      ))}
    </nav>
  );
}
