// Pure number formatting for the list funnel, the header strip and the
// count + % on each node.

import { pct } from "@/lib/os/experiments/stats";
import type { FunnelStrip, NodeStat } from "@/components/os/workflows/types";

const share = (n: number, of: number) => (of > 0 && n > 0 ? pct(n / of) : "");

/** List row: Triggered · Replied · Lead magnet · Booked, % of the one before, bar vs triggered. */
export function listFunnel(f: FunnelStrip) {
  const steps = [
    { key: "triggered", n: f.triggered },
    { key: "replied", n: f.replied },
    { key: "leadMagnet", n: f.leadMagnet },
    { key: "booked", n: f.booked },
  ];
  const max = f.triggered || 1;
  return steps.map((s, i) => ({
    key: s.key,
    n: i === 2 && s.n === 0 ? "—" : String(s.n),
    pct: i === 0 ? "" : share(s.n, steps[i - 1].n),
    bar: Math.min(100, Math.round((s.n / max) * 100)),
  }));
}

/** Header: Triggered → Replied → Lead magnet → Booked → Showed. */
export function stripItems(f: FunnelStrip) {
  const steps = [
    { label: "Triggered", n: f.triggered },
    { label: "Replied", n: f.replied },
    { label: "Lead magnet", n: f.leadMagnet },
    { label: "Booked", n: f.booked },
    { label: "Showed", n: f.showed },
  ];
  return steps.map((s, i) => ({ label: s.label, n: s.n, pct: i === 0 ? "" : share(s.n, steps[i - 1].n) }));
}

/** "41 · 64%" on a node; "41" for the trigger; "" with no data. */
export function nodeStatText(s: NodeStat | undefined): { n: string; pct: string } {
  if (!s) return { n: "", pct: "" };
  return { n: String(s.reached), pct: s.share === null ? "" : s.share > 0 ? pct(s.share) : "0%" };
}

export function sinceLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return `Since ${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}`;
}
