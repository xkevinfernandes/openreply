// Inbox red dot: contacts whose latest workflow run failed (a send error
// after retries, O6), with the reason. One query for a page of threads.
// Added by C2 wfcanvas next to the engine's api.ts.

import { prisma } from "@/lib/db/client";

/** contactId → failReason for contacts whose most recent run is FAILED. */
export async function failedRuns(workspaceId: string, contactIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(contactIds.filter(Boolean))].slice(0, 200);
  if (!ids.length) return {};
  const rows = await prisma.workflowRun.findMany({
    where: { workspaceId, contactId: { in: ids } },
    orderBy: { startedAt: "desc" },
    select: { contactId: true, status: true, failReason: true },
  });
  const out: Record<string, string> = {};
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.contactId || seen.has(r.contactId)) continue;
    seen.add(r.contactId);
    if (r.status === "FAILED") out[r.contactId] = r.failReason || "A send failed";
  }
  return out;
}
