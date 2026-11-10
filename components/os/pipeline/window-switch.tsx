"use client";

import { SegmentedSwitch } from "@claudepreneur/brand/react";
import type { FunnelWindow } from "@/lib/os/crm-funnel";
import { WINDOWS } from "@/lib/os/home-funnel-view";

/** The 7d / 30d / 90d switch (Home's funnel and the All board): the shared SegmentedSwitch. */
export function WindowSwitch({ value, onChange }: { value: FunnelWindow; onChange: (w: FunnelWindow) => void }) {
  return (
    <SegmentedSwitch
      label="Window"
      className="os-fn-switch"
      value={String(value)}
      onChange={(v) => onChange(Number(v) as FunnelWindow)}
      options={WINDOWS.map((w) => ({ value: String(w), label: `${w}d` }))}
    />
  );
}
