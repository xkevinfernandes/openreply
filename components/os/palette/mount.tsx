"use client";

// ⌘K palette mount point (wave-0 stub; owner: S6). The shell renders it once.
// It owns the ⌘K / Ctrl+K shortcut and the "os:palette" event; S6 replaces
// the body with the real palette (threads, contacts, screens, KB docs, actions).

import { useEffect, useState } from "react";
import { PALETTE_EVENT } from "@/components/os/keys";

export default function PaletteMount() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(PALETTE_EVENT, onOpen);
    };
  }, []);

  if (!open) return null;
  return (
    <div className="os-palette-scrim" role="presentation" onClick={() => setOpen(false)}>
      <div className="os-palette" role="dialog" aria-modal="true" aria-label="Search or jump to" onClick={(e) => e.stopPropagation()}>
        <input className="os-palette-input" autoFocus placeholder="Search or jump to…" aria-label="Search or jump to" />
        <p className="os-palette-empty">Search is coming soon.</p>
      </div>
    </div>
  );
}
