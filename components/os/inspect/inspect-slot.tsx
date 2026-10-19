"use client";

// Where the Inspect drawer opens: in place of the contact panel, while open.
// Another contact (the panel remounts) or leaving the page closes it.

import { useEffect } from "react";
import { closeInspect, useInspect } from "@/components/os/inspect/bus";
import InspectDrawer from "@/components/os/inspect/inspect-drawer";

export default function InspectSlot({ children }: { children: React.ReactNode }) {
  const req = useInspect();
  useEffect(() => () => closeInspect(), []);
  if (!req) return <>{children}</>;
  return <InspectDrawer key={req.draftId} draftId={req.draftId} onClose={closeInspect} />;
}
