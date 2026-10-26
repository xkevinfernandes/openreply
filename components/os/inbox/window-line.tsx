"use client";

// Above the composer (dm-crm 011, display only): which Instagram window the
// thread is in and the time left, counting down. It changes nothing about
// what can be sent.

import { useEffect, useState } from "react";
import { windowDisplay } from "@/lib/os/inbox-stream";

export default function WindowLine({ lastInboundAt, zernio, tz, now: first }: { lastInboundAt: string | null; zernio: boolean; tz?: string; now: number }) {
  const [now, setNow] = useState(first);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const w = windowDisplay(lastInboundAt, now, { zernio, tz });
  if (w.kind === "none") return null;
  return (
    <div className="os-ix-window" data-kind={w.kind} role="status">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
        <circle cx="8" cy="8" r="5.8" />
        <path d="M8 5v3l2 1.5" />
      </svg>
      <span className="os-ix-window-main">{w.label}</span>
      {w.sub ? <span className="os-ix-window-sub">{w.sub}</span> : null}
    </div>
  );
}
