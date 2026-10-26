"use client";

// Pipeline's board switcher, the same on both boards: "All · funnel"
// (/os/pipeline/all) then one tab per setter (/os/pipeline?setter=).

import { Tabs } from "@/components/os/ui";
import { ALL_BOARD } from "@/lib/os/pipeline-board";

export function BoardSwitch({ setters, value }: { setters: { id: string; name: string }[]; value: string }) {
  return (
    <Tabs
      tabs={[{ key: ALL_BOARD, label: "All · funnel" }, ...setters.map((s) => ({ key: s.id, label: s.name }))]}
      value={value}
      ariaLabel="Board"
      hrefFor={(k) => (k === ALL_BOARD ? "/os/pipeline/all" : `/os/pipeline?setter=${encodeURIComponent(k)}`)}
    />
  );
}
