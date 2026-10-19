// The Contacts screen (build step 5): every contact as a table or a Kanban
// board. One read per page load; filtering, search and selection happen in
// the browser (lib/os/contacts-filter.ts), so the board stays instant.

import type { ContactKind, ContactStage } from "@/app/generated/prisma/enums";
import { prisma } from "@/lib/db/client";
import type { FunnelStageLike } from "@/lib/os/funnel";
import { mockContactExtras, mockThreads, osMockEnabled } from "@/lib/os/mock";
import { MOCK_CARD_NOTES, MOCK_FOLLOWUPS, MOCK_SOURCES } from "@/lib/os/mock-contacts";
import type { BookedCall } from "@/components/os/inbox/booked-call";
import { activeCalendar } from "@/lib/os/integrations/calendar/store";
import { latestBookings } from "@/lib/os/setter/booking-store";
import { requestPendingDrafts } from "@/lib/os/inbox";

export interface ContactRow {
  id: string;
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  kind: ContactKind;
  stage: ContactStage;
  setterStage: string | null;
  entryPath: string | null;
  tags: string[];
  paused: boolean;
  /** On the Follow-up Friday list. */
  onFriday: boolean;
  notes: string | null;
  email: string | null;
  lastMessageAt: string | null;
  zernioConversationId: string | null;
  /** Null = the default setter for the account. */
  setterId: string | null;
  /** J has a draft waiting for approval. */
  draftWaiting: boolean;
  /** The call J booked in the DM, if any. */
  booking?: BookedCall | null;
  /** One line for the card: Kevin's note, else what J learned. */
  note?: string | null;
  /** The keyword they triggered (DmLog), e.g. "SETTER". */
  source?: string | null;
  /** A follow-up is queued. */
  followup?: boolean;
  /** Latest call's attendance (Showed / No-show columns). */
  attendance?: "SHOWED" | "NO_SHOW" | null;
}

export interface SetterOption {
  id: string;
  name: string;
  /** The setter's funnel (Kanban columns). */
  funnel?: FunnelStageLike[];
  isDefault?: boolean;
}

export interface ContactsData {
  contacts: ContactRow[];
  setters: SetterOption[];
  /** True when the read hit the cap: the oldest contacts are not shown. */
  truncated: boolean;
}

/** Most contacts one page load reads, newest message first. */
export const CONTACTS_CAP = 2000;

async function draftContactIds(workspaceId: string): Promise<Set<string>> {
  try {
    return new Set((await requestPendingDrafts(workspaceId)).map((d) => d.contactId));
  } catch (err) {
    console.error("[OS Contacts] drafts failed:", err instanceof Error ? err.message : err);
    return new Set();
  }
}

function mockContacts(drafts: Set<string>): ContactRow[] {
  return mockThreads().flatMap((t) => {
    if (!t.contact) return [];
    const x = mockContactExtras(t.contact.id);
    return [
      {
        id: t.contact.id,
        username: t.username,
        fullName: t.fullName ?? null,
        avatarUrl: t.avatarUrl ?? null,
        kind: t.contact.kind,
        stage: t.contact.stage,
        setterStage: t.contact.setterStage,
        entryPath: t.contact.entryPath,
        tags: [...x.tags],
        paused: t.contact.paused,
        onFriday: t.contact.onFriday,
        notes: x.notes,
        email: x.email,
        lastMessageAt: t.updatedTime,
        zernioConversationId: t.conversationId,
        setterId: null,
        draftWaiting: drafts.has(t.contact.id),
        note: MOCK_CARD_NOTES[t.contact.id] ?? x.notes,
        source: MOCK_SOURCES[t.contact.id] ?? null,
        followup: MOCK_FOLLOWUPS.has(t.contact.id),
        attendance: t.contact.id === "c8" ? "NO_SHOW" : null,
      },
    ];
  });
}

/** A setter's funnel JSON as column stages. */
export function funnelOf(json: unknown): FunnelStageLike[] {
  return Array.isArray(json)
    ? json
        .filter((s): s is { key?: unknown; label?: unknown } => Boolean(s) && typeof s === "object")
        .filter((s) => typeof s.key === "string" || typeof s.label === "string")
        .map((s) => ({ key: String(s.key ?? s.label), label: String(s.label ?? s.key) }))
    : [];
}

async function setterOptions(workspaceId: string): Promise<SetterOption[]> {
  const rows = await prisma.setter.findMany({ where: { workspaceId }, select: { id: true, name: true, funnel: true, isDefault: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
  return rows.map((r) => ({ id: r.id, name: r.name, funnel: funnelOf(r.funnel), isDefault: r.isDefault }));
}

/** J's one-line read of them from the field values, e.g. "Notion shop, ~$4k/mo". */
export function noteFromFields(values: { key: string; value: string }[]): string | null {
  const order = ["business", "niche", "monthly_revenue", "their_goal", "their_challenge"];
  const picked = order.map((k) => values.find((v) => v.key === k)?.value).filter((v): v is string => Boolean(v));
  return picked.length ? picked.slice(0, 3).join(", ") : null;
}

/** Cheap extras for the cards: keyword, queued follow-up, attendance, field note. */
async function cardExtras(workspaceId: string, rows: { id: string; igUserId: string; instagramAccountId: string }[]) {
  const ids = rows.map((r) => r.id);
  const [logs, steps, bookings, values] = await Promise.all([
    prisma.dmLog.findMany({
      where: { workspaceId, commenterId: { in: [...new Set(rows.map((r) => r.igUserId))] } },
      orderBy: { createdAt: "desc" },
      select: { commenterId: true, instagramAccountId: true, matchedKeyword: true },
      take: 5000,
    }),
    prisma.followupStep.findMany({ where: { workspaceId, contactId: { in: ids }, status: { in: ["QUEUED", "DRAFTED"] } }, select: { contactId: true } }),
    prisma.booking.findMany({ where: { workspaceId, contactId: { in: ids }, attendance: { not: null } }, orderBy: { createdAt: "desc" }, select: { contactId: true, attendance: true } }),
    prisma.contactFieldValue.findMany({ where: { contactId: { in: ids } }, select: { contactId: true, value: true, field: { select: { key: true } } } }),
  ]);
  const keyword = new Map<string, string>();
  for (const l of logs) {
    const k = `${l.instagramAccountId}:${l.commenterId}`;
    if (l.matchedKeyword && !keyword.has(k)) keyword.set(k, l.matchedKeyword.toUpperCase());
  }
  const attendance = new Map<string, "SHOWED" | "NO_SHOW">();
  for (const b of bookings) if (b.attendance && !attendance.has(b.contactId)) attendance.set(b.contactId, b.attendance);
  const byContact = new Map<string, { key: string; value: string }[]>();
  for (const v of values) byContact.set(v.contactId, [...(byContact.get(v.contactId) ?? []), { key: v.field.key, value: v.value }]);
  const queued = new Set(steps.map((s) => s.contactId));
  return (r: { id: string; igUserId: string; instagramAccountId: string }) => ({
    source: keyword.get(`${r.instagramAccountId}:${r.igUserId}`) ?? null,
    followup: queued.has(r.id),
    attendance: attendance.get(r.id) ?? null,
    fieldNote: noteFromFields(byContact.get(r.id) ?? []),
  });
}

/** Each contact's booked call, in Kevin's time. A failure leaves them off. */
async function bookingsFor(workspaceId: string, ids: string[]): Promise<(id: string) => BookedCall | null> {
  try {
    const [map, calendar] = await Promise.all([latestBookings(workspaceId, ids), activeCalendar(workspaceId, null).catch(() => null)]);
    const host = calendar?.settings.hostTimezone;
    return (id) => {
      const b = map.get(id);
      return b ? { start: b.start, timezone: b.timezone, hostTimezone: host ?? b.timezone, status: b.status, email: b.email } : null;
    };
  } catch (err) {
    console.error("[OS Contacts] bookings failed:", err instanceof Error ? err.message : err);
    return () => null;
  }
}

async function withBookings(workspaceId: string, rows: ContactRow[]): Promise<ContactRow[]> {
  const of = await bookingsFor(workspaceId, rows.map((r) => r.id));
  return rows.map((r) => {
    const booking = of(r.id);
    return booking ? { ...r, booking } : r;
  });
}

export async function listContacts(workspaceId: string): Promise<ContactsData> {
  if (osMockEnabled()) {
    const [drafts, setters] = await Promise.all([draftContactIds(workspaceId), setterOptions(workspaceId).catch(() => [])]);
    return { contacts: await withBookings(workspaceId, mockContacts(drafts)), setters, truncated: false };
  }

  // Drafts, contacts and setters at once; then the card extras and bookings at once.
  const [drafts, rows, setters] = await Promise.all([
    draftContactIds(workspaceId),
    prisma.contact.findMany({
      where: { workspaceId },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: CONTACTS_CAP + 1,
      select: {
        id: true,
        username: true,
        fullName: true,
        avatarUrl: true,
        kind: true,
        stage: true,
        setterStage: true,
        entryPath: true,
        tags: true,
        paused: true,
        onFriday: true,
        notes: true,
        email: true,
        lastMessageAt: true,
        zernioConversationId: true,
        setterId: true,
        igUserId: true,
        instagramAccountId: true,
      },
    }),
    setterOptions(workspaceId),
  ]);
  const kept = rows.slice(0, CONTACTS_CAP);
  const [extra, bookings] = await Promise.all([
    cardExtras(workspaceId, kept).catch((err) => {
      console.error("[OS Contacts] card extras failed:", err instanceof Error ? err.message : err);
      return null;
    }),
    bookingsFor(workspaceId, kept.map((r) => r.id)),
  ]);

  return {
    contacts: kept.map(({ igUserId, instagramAccountId, ...c }) => {
      const x = extra?.({ id: c.id, igUserId, instagramAccountId });
      const booking = bookings(c.id);
      return {
        ...c,
        lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
        draftWaiting: drafts.has(c.id),
        note: c.notes?.split("\n")[0]?.slice(0, 120) || x?.fieldNote || null,
        source: x?.source ?? null,
        followup: x?.followup ?? false,
        attendance: x?.attendance ?? null,
        ...(booking ? { booking } : {}),
      };
    }),
    setters,
    truncated: rows.length > CONTACTS_CAP,
  };
}
