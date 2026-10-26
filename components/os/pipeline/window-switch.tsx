"use client";

import "./funnel-shared.css";
import type { FunnelWindow } from "@/lib/os/crm-funnel";
import { WINDOWS } from "@/lib/os/home-funnel-view";

/** The 7d / 30d / 90d pill switch (Home's funnel and the All board). */
export function WindowSwitch({ value, onChange }: { value: FunnelWindow; onChange: (w: FunnelWindow) => void }) {
  return (
    <div className="os-fn-switch" role="group" aria-label="Window">
      {WINDOWS.map((w) => (
        <button key={w} type="button" aria-pressed={w === value} onClick={() => onChange(w)}>
          {w}d
        </button>
      ))}
    </div>
  );
}
