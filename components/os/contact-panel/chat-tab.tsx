"use client";

// Chat tab (Contacts push panel). Wave-0 stub; owner: S1 (the Instagram-style
// thread and composer, shared with the Inbox).
import { EmptyState } from "@/components/os/ui";
import type { ContactPanelData } from "@/lib/os/contact-panel/types";

export default function ChatTab({ data }: { data: ContactPanelData }) {
  return (
    <EmptyState title="Chat">
      {data.conversationId ? <a href={`/os/inbox?c=${encodeURIComponent(data.conversationId)}`}>Open in Inbox</a> : "No conversation yet."}
    </EmptyState>
  );
}
