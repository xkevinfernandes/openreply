"use client";

// Follow-ups tab. Wave-0 stub; owner: S5.
import { EmptyState } from "@/components/os/ui";
import type { ContactPanelData } from "@/lib/os/contact-panel/types";

export default function FollowupsTab({ data }: { data: ContactPanelData }) {
  return <EmptyState title={data.nextFollowup?.label ?? "No follow-up scheduled"} />;
}
