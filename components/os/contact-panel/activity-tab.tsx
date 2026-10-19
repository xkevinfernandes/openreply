"use client";

// Activity tab (timeline). Wave-0 stub; owner: S3.
import { EmptyState } from "@/components/os/ui";
import type { ContactPanelData } from "@/lib/os/contact-panel/types";

export default function ActivityTab({ data }: { data: ContactPanelData }) {
  void data;
  return <EmptyState title="Activity" />;
}
