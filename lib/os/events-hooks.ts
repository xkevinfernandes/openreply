// Hooks that turn what happens on send paths into OsEvents (Home's numbers).
// Call sites (wave 0): setter/service.ts (draft sent, thread observed),
// contacts-edit.ts + inbox actions (stage), setter/booking-store.ts (booked),
// sequences/engine.ts markAttendance (showed). Owner after wave 0: S6.
//
// Every hook swallows its own errors: a lost event never fails a send.
// dm_sent is NOT recorded here: lib/os/sending/cap.ts counts each bubble.
// conversation_started follows the episode rule in lib/os/metrics.ts.

import type { ContactStage } from "@/app/generated/prisma/enums";
import { prisma } from "@/lib/db/client";
import { eventKey, recordEventQuietly, recordEvents, type OsEventInput } from "@/lib/os/events";
import { captureFields } from "@/lib/os/fields/capture";
import { conversationStartFromRecord } from "@/lib/os/metrics";
import { catalogRowFromResource } from "@/lib/os/setter/kb";
import { resolve } from "@/lib/os/setter/resources";
import type { SetterRecord } from "@/lib/os/setter/state";

export interface DraftSentInfo {
  workspaceId: string;
  contactId: string;
  setterId: string | null;
  draftId: string;
  /** Draft.kind: reply | value_opener | nudge | invite | booking | followup… */
  kind: string;
  bubbles: string[];
  /** Draft.raw: J's output JSON (fields J filled live here). */
  raw?: unknown;
  at: Date;
}

export interface ThreadObservedInfo {
  workspaceId: string;
  contactId: string;
  setterId: string | null;
  record: SetterRecord;
  at: Date;
}

export interface OsEventHooks {
  onDraftSent(info: DraftSentInfo): Promise<void>;
  onThreadObserved(info: ThreadObservedInfo): Promise<void>;
  onStageChanged(info: { workspaceId: string; contactId: string; stage: ContactStage; at?: Date }): Promise<void>;
  onBooking(info: { workspaceId: string; contactId: string; bookingId: string; at?: Date }): Promise<void>;
  onAttendance(info: { workspaceId: string; contactId: string; bookingId: string; attendance: "SHOWED" | "NO_SHOW" | null; at?: Date }): Promise<void>;
}

/** Draft kinds that put an offer in front of them. */
export const OFFER_KINDS = new Set(["invite", "booking"]);

/** Pure: the events one sent draft stands for (lead magnets resolved by the caller). */
export function draftSentEvents(info: DraftSentInfo, leadMagnetIds: string[]): OsEventInput[] {
  const base = { workspaceId: info.workspaceId, contactId: info.contactId, setterId: info.setterId, at: info.at };
  const out: OsEventInput[] = [];
  if (OFFER_KINDS.has(info.kind)) out.push({ ...base, kind: "offer_made", dedupeKey: eventKey("offer_made", info.draftId), data: { draftKind: info.kind } });
  for (const resourceId of leadMagnetIds) {
    // Once per person per lead magnet, however often the link is resent.
    out.push({ ...base, kind: "lead_magnet_sent", dedupeKey: eventKey("lead_magnet_sent", info.contactId, resourceId), data: { resourceId, draftId: info.draftId } });
  }
  return out;
}

async function leadMagnetsIn(workspaceId: string, bubbles: string[]): Promise<string[]> {
  const rows = await prisma.resource.findMany({ where: { workspaceId, kind: "resource" } });
  if (!rows.length) return [];
  const hits = resolve(bubbles, rows.map(catalogRowFromResource));
  const bySlug = new Map(rows.map((r) => [r.slug, r.id]));
  return hits.map((h) => bySlug.get(h.slug)).filter((id): id is string => !!id);
}

const quiet = async (label: string, fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (err) {
    console.error(`[OS Events] ${label}:`, err instanceof Error ? err.message : err);
  }
};

export const osEventHooks: OsEventHooks = {
  async onDraftSent(info) {
    await quiet("draft sent", async () => recordEvents(draftSentEvents(info, await leadMagnetsIn(info.workspaceId, info.bubbles))));
    await quiet("capture fields", () => captureFields({ workspaceId: info.workspaceId, contactId: info.contactId, setterId: info.setterId, draftId: info.draftId, raw: info.raw }));
  },
  async onThreadObserved({ workspaceId, contactId, setterId, record }) {
    const e = conversationStartFromRecord(record, { workspaceId, contactId, setterId });
    if (e) await recordEventQuietly(e);
  },
  async onStageChanged({ workspaceId, contactId, stage, at }) {
    if (stage !== "WON") return;
    await recordEventQuietly({ workspaceId, contactId, kind: "won", dedupeKey: eventKey("won", contactId), at });
  },
  async onBooking({ workspaceId, contactId, bookingId, at }) {
    await recordEventQuietly({ workspaceId, contactId, kind: "call_booked", dedupeKey: eventKey("call_booked", bookingId), at, data: { bookingId } });
  },
  async onAttendance({ workspaceId, contactId, bookingId, attendance, at }) {
    if (attendance !== "SHOWED") return;
    await recordEventQuietly({ workspaceId, contactId, kind: "showed", dedupeKey: eventKey("showed", bookingId), at, data: { bookingId } });
  },
};
