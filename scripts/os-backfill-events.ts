// Backfill Home's OsEvent log from existing rows (lib/os/metrics-backfill.ts).
// Safe to re-run: every event has the live hooks' dedupeKey.
//
//   npx tsx scripts/os-backfill-events.ts [--workspace <id>] [--dry-run]

import { prisma } from "@/lib/db/client";
import { recordEvents, type OsEventInput } from "@/lib/os/events";
import { backfillEvents, type LeadMagnetResolver } from "@/lib/os/metrics-backfill";
import { catalogRowFromResource } from "@/lib/os/setter/kb";
import { resolve } from "@/lib/os/setter/resources";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const workspaceId = flag("--workspace");
const dryRun = args.includes("--dry-run");

async function main() {
  const ws = workspaceId ? { workspaceId } : {};
  const [dmLogs, drafts, bookings, states, fridaySends, wonContacts, resources] = await Promise.all([
    prisma.dmLog.findMany({ where: ws, select: { id: true, workspaceId: true, automationId: true, matchedKeyword: true, createdAt: true } }),
    prisma.draft.findMany({
      where: { ...ws, status: "SENT" },
      select: { id: true, workspaceId: true, contactId: true, setterId: true, kind: true, bubbles: true, editedText: true, sentAt: true, decidedAt: true, createdAt: true },
    }),
    prisma.booking.findMany({ where: ws, select: { id: true, workspaceId: true, contactId: true, createdAt: true, attendance: true, attendanceAt: true, start: true } }),
    prisma.setterState.findMany({ where: ws, select: { workspaceId: true, contactId: true, record: true, contact: { select: { setterId: true } } } }),
    prisma.fridaySend.findMany({ where: ws, select: { workspaceId: true, contactId: true, resourceId: true, status: true, sentAt: true, createdAt: true } }),
    prisma.contact.findMany({ where: { ...ws, stage: "WON" }, select: { id: true, workspaceId: true, updatedAt: true } }),
    prisma.resource.findMany({ where: { ...ws, kind: "resource" } }),
  ]);

  const byWs = new Map<string, typeof resources>();
  for (const r of resources) byWs.set(r.workspaceId, [...(byWs.get(r.workspaceId) ?? []), r]);
  const leadMagnets: LeadMagnetResolver = (wsId, bubbles) => {
    const rows = byWs.get(wsId) ?? [];
    if (!rows.length) return [];
    const bySlug = new Map(rows.map((r) => [r.slug, r.id]));
    return resolve(bubbles, rows.map(catalogRowFromResource))
      .map((h) => bySlug.get(h.slug))
      .filter((id): id is string => !!id);
  };

  const events = backfillEvents(
    { dmLogs, drafts, bookings, states: states.map((s) => ({ workspaceId: s.workspaceId, contactId: s.contactId, setterId: s.contact.setterId, record: s.record })), fridaySends, wonContacts },
    leadMagnets
  );

  const byKind = new Map<string, number>();
  for (const e of events) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
  console.log(`Candidates: ${events.length}`, Object.fromEntries(byKind));
  if (dryRun) return;

  let added = 0;
  for (let i = 0; i < events.length; i += 500) added += await recordEvents(events.slice(i, i + 500) as OsEventInput[]);
  console.log(`New events: ${added} (the rest were already logged).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
