// OS_MOCK=1 inbox stream (dm-crm issues 009-014): the sample threads of
// lib/os/mock.ts with their CRM fields from lib/os/mock-crm.ts. A message sent
// or received on sample data moves its thread to the top.

import { mockThreads } from "@/lib/os/mock";
import { mockCrmState } from "@/lib/os/mock-crm";
import { EMPTY_CRM, laterIso, sortStream, type StreamThread } from "@/lib/os/inbox-stream";

export function mockStream(): StreamThread[] {
  return sortStream(
    mockThreads().map((t) => {
      const crm = t.contact ? { ...mockCrmState(t.contact.id) } : EMPTY_CRM;
      // Zernio's count on the sample: shown only while local says unread.
      const unreadCount = t.contact?.id === "c2" ? 2 : t.unreadCount;
      return { ...t, unreadCount, updatedTime: laterIso(laterIso(t.updatedTime, crm.lastInboundAt), crm.lastOutboundAt), crm };
    })
  );
}
