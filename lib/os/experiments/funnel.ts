// Funnel attribution per variant, counted from data we already keep: the
// assignment's send time, J's state record (their replies, deliveries, the
// invite), drafts that went out, Friday sends, bookings and the contact's
// Kanban stage. Every step counts only what happened after the line went out.

import type { ContactStage } from "@/app/generated/prisma/client";

export interface ContactFacts {
  /** Their last message (any inbound, a button tap counts). */
  theirLastAt: string | null;
  /** Resource deliveries: rec.delivered_at, "delivered:" history events, Friday sends. */
  valueAts: string[];
  /** Invites: rec.invited.at, invite / booking drafts sent. */
  inviteAts: string[];
  /** Bookings that aren't cancelled (createdAt). */
  bookedAts: string[];
  stage: ContactStage | null;
}

export interface Exposure {
  variantId: string;
  /** When the line went out; null = assigned, not sent yet. */
  sentAt: string | null;
  edited: boolean;
  facts: ContactFacts | null;
}

export interface FunnelCounts {
  assigned: number;
  sent: number;
  edited: number;
  replied: number;
  valueSent: number;
  inviteSent: number;
  booked: number;
  showed: number;
}

export const emptyCounts = (): FunnelCounts => ({
  assigned: 0,
  sent: 0,
  edited: 0,
  replied: 0,
  valueSent: 0,
  inviteSent: 0,
  booked: 0,
  showed: 0,
});

const BOOKED_STAGES: ContactStage[] = ["CALL_BOOKED", "SHOWED", "WON"];
const SHOWED_STAGES: ContactStage[] = ["SHOWED", "WON"];

const after = (ats: (string | null | undefined)[], t: number) => ats.some((a) => a != null && new Date(a).getTime() >= t);

/** Counts for one variant's exposures. */
export function countFunnel(exposures: Exposure[]): FunnelCounts {
  const c = emptyCounts();
  for (const e of exposures) {
    c.assigned++;
    if (!e.sentAt) continue;
    c.sent++;
    if (e.edited) c.edited++;
    const f = e.facts;
    if (!f) continue;
    const t = new Date(e.sentAt).getTime();
    // A reply in the same second as our send is the same burst, not an answer.
    if (f.theirLastAt && new Date(f.theirLastAt).getTime() > t) c.replied++;
    if (after(f.valueAts, t)) c.valueSent++;
    if (after(f.inviteAts, t)) c.inviteSent++;
    // The Kanban stage has no time: it counts because a contact keeps its
    // variant and the stage only moves forward from the first line.
    if (after(f.bookedAts, t) || (f.stage && BOOKED_STAGES.includes(f.stage))) c.booked++;
    if (f.stage && SHOWED_STAGES.includes(f.stage)) c.showed++;
  }
  return c;
}

export function byVariant(exposures: Exposure[], variantIds: string[]): Map<string, FunnelCounts> {
  const out = new Map(variantIds.map((id) => [id, emptyCounts()]));
  const groups = new Map<string, Exposure[]>();
  for (const e of exposures) groups.set(e.variantId, [...(groups.get(e.variantId) ?? []), e]);
  for (const [id, list] of groups) out.set(id, countFunnel(list));
  return out;
}

/** The facts from J's state record (SetterState.record). */
export function factsFromRecord(
  rec: { their_last_at?: string | null; delivered_at?: string | null; invited?: { at?: string } | null; history?: { at: string | null; event: string }[] } | null,
  extra: { valueAts?: string[]; inviteAts?: string[]; bookedAts?: string[]; stage?: ContactStage | null } = {}
): ContactFacts {
  const delivered = (rec?.history ?? []).filter((h) => h.event.startsWith("delivered:")).map((h) => h.at);
  return {
    theirLastAt: rec?.their_last_at ?? null,
    valueAts: [rec?.delivered_at, ...delivered, ...(extra.valueAts ?? [])].filter((x): x is string => Boolean(x)),
    inviteAts: [rec?.invited?.at, ...(extra.inviteAts ?? [])].filter((x): x is string => Boolean(x)),
    bookedAts: extra.bookedAts ?? [],
    stage: extra.stage ?? null,
  };
}
