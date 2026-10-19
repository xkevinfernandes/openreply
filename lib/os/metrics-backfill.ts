// One-time (re-runnable) backfill of the OsEvent log from what the DB already
// knows: DmLog (keyword triggers), sent Drafts (offers, lead magnets), Bookings
// (booked, showed), SetterState (conversations started), FridaySend (lead
// magnets) and WON contacts. Every event carries the same dedupeKey the live
// hooks use, so running it twice, or after the hooks, never double counts.
// Pure: the runner is scripts/os-backfill-events.ts.

import { eventKey, type OsEventInput } from "@/lib/os/events";
import { draftSentEvents } from "@/lib/os/events-hooks";
import { conversationStartFromRecord, keywordTriggerEvents, type DmLogLite } from "@/lib/os/metrics";
import type { SetterRecord } from "@/lib/os/setter/state";

export interface BackfillRows {
  dmLogs: DmLogLite[];
  drafts: { id: string; workspaceId: string; contactId: string; setterId: string | null; kind: string; bubbles: string[]; editedText: string | null; sentAt: Date | null; decidedAt: Date | null; createdAt: Date }[];
  bookings: { id: string; workspaceId: string; contactId: string; createdAt: Date; attendance: "SHOWED" | "NO_SHOW" | null; attendanceAt: Date | null; start: Date }[];
  states: { workspaceId: string; contactId: string; setterId: string | null; record: unknown }[];
  fridaySends: { workspaceId: string; contactId: string; resourceId: string | null; status: string; sentAt: Date | null; createdAt: Date }[];
  wonContacts: { id: string; workspaceId: string; updatedAt: Date }[];
}

/** Lead magnets linked in a set of bubbles (resource ids), per workspace. */
export type LeadMagnetResolver = (workspaceId: string, bubbles: string[]) => string[];

export function backfillEvents(rows: BackfillRows, leadMagnets: LeadMagnetResolver): OsEventInput[] {
  const out: OsEventInput[] = [...keywordTriggerEvents(rows.dmLogs)];

  for (const d of rows.drafts) {
    const at = d.sentAt ?? d.decidedAt ?? d.createdAt;
    const bubbles = d.editedText ? [d.editedText] : d.bubbles;
    out.push(
      ...draftSentEvents(
        { workspaceId: d.workspaceId, contactId: d.contactId, setterId: d.setterId, draftId: d.id, kind: d.kind, bubbles, at },
        leadMagnets(d.workspaceId, bubbles)
      )
    );
  }

  for (const b of rows.bookings) {
    out.push({ workspaceId: b.workspaceId, contactId: b.contactId, kind: "call_booked", dedupeKey: eventKey("call_booked", b.id), at: b.createdAt, data: { bookingId: b.id } });
    if (b.attendance === "SHOWED") {
      out.push({ workspaceId: b.workspaceId, contactId: b.contactId, kind: "showed", dedupeKey: eventKey("showed", b.id), at: b.attendanceAt ?? b.start, data: { bookingId: b.id } });
    }
  }

  for (const s of rows.states) {
    const rec = s.record as SetterRecord | null;
    if (!rec || typeof rec !== "object") continue;
    const e = conversationStartFromRecord(rec, { workspaceId: s.workspaceId, contactId: s.contactId, setterId: s.setterId });
    if (e) out.push(e);
  }

  for (const f of rows.fridaySends) {
    if (!f.resourceId || f.status === "sending") continue;
    out.push({
      workspaceId: f.workspaceId,
      contactId: f.contactId,
      kind: "lead_magnet_sent",
      dedupeKey: eventKey("lead_magnet_sent", f.contactId, f.resourceId),
      at: f.sentAt ?? f.createdAt,
      data: { resourceId: f.resourceId, via: "friday" },
    });
  }

  for (const c of rows.wonContacts) {
    out.push({ workspaceId: c.workspaceId, contactId: c.id, kind: "won", dedupeKey: eventKey("won", c.id), at: c.updatedAt });
  }
  return out;
}
