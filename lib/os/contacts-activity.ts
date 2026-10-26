// The contact panel's Activity tab: one timeline, newest first, built from
// the OsEvent log, keyword triggers, J's field captures and bookings.
import { prisma } from "@/lib/db/client";
import { mockContactPanel, osMockEnabled } from "@/lib/os/mock";
import { mockFieldValues, mockLeadMagnets } from "@/lib/os/mock-contacts";
import { mockCurrency } from "@/lib/os/mock-crm";
import { mockWonData } from "@/lib/os/mock-contacts-crm";
import { wonDataOf } from "@/lib/os/events";
import { formatMoney } from "@/lib/os/money";

export type ActivityKind =
  | "keyword"
  | "conversation"
  | "lead_magnet"
  | "offer"
  | "booked"
  | "showed"
  | "won"
  | "field"
  | "followup";

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  /** "Triggered SETTER", "J filled Business". */
  label: string;
  /** The value or resource, shown muted. */
  detail: string | null;
  at: string;
  /** Who did it: the setter's name, "OpenReply", or null. */
  by: string | null;
}

const EVENT_LABEL: Record<string, { kind: ActivityKind; label: string }> = {
  conversation_started: { kind: "conversation", label: "Conversation started" },
  lead_magnet_sent: { kind: "lead_magnet", label: "Lead magnet sent" },
  offer_made: { kind: "offer", label: "Offered a call" },
  call_booked: { kind: "booked", label: "Call booked" },
  showed: { kind: "showed", label: "Showed up" },
  won: { kind: "won", label: "Won" },
};

/** The Won row's detail from the won event's data: "1:1 Mentorship · €6,000". */
export function wonDetail(data: unknown, currency: string): string | null {
  const w = wonDataOf(data);
  if (!w) return null;
  return `${w.offer ? `${w.offer} · ` : ""}${formatMoney(w.amount, currency)}`;
}

/** Newest first, ties broken by id so the order is stable. */
export function sortActivity(items: ActivityItem[]): ActivityItem[] {
  return [...items].sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}

function mockActivity(contactId: string): ActivityItem[] {
  const panel = mockContactPanel(contactId);
  const items: ActivityItem[] = [];
  for (const [i, k] of (panel?.keywords ?? []).entries()) {
    if (!k.at) continue;
    items.push({ id: `kw${i}`, kind: "keyword", label: k.surface === "story_reply" ? "Replied to a story" : `Triggered ${k.word}`, detail: k.resource, at: k.at, by: null });
  }
  for (const [i, m] of mockLeadMagnets(contactId).entries()) {
    items.push({ id: `lm${i}`, kind: "lead_magnet", label: "Lead magnet sent", detail: m.name, at: m.at, by: m.via === "openreply" ? "OpenReply" : "J" });
  }
  for (const [key, v] of Object.entries(mockFieldValues(contactId))) {
    if (v.source !== "j") continue;
    const label = panel?.fields.find((f) => f.key === key)?.label ?? key;
    items.push({ id: `f-${key}`, kind: "field", label: `Filled ${label}`, detail: v.value, at: v.at, by: "J" });
  }
  const won = mockWonData(contactId);
  const wonAt = typeof won?.wonAt === "string" ? won.wonAt : null;
  if (won && wonAt) items.push({ id: "won", kind: "won", label: "Won", detail: wonDetail(won, mockCurrency()), at: wonAt, by: null });
  return sortActivity(items);
}

export async function loadContactActivity(workspaceId: string, contactId: string, limit = 60): Promise<ActivityItem[]> {
  if (osMockEnabled()) return mockActivity(contactId);
  const contact = await prisma.contact.findFirst({ where: { id: contactId, workspaceId }, select: { igUserId: true, instagramAccountId: true } });
  if (!contact) return [];

  const [events, logs, values, setters] = await Promise.all([
    prisma.osEvent.findMany({ where: { workspaceId, contactId, kind: { not: "dm_sent" } }, orderBy: { at: "desc" }, take: limit, select: { id: true, kind: true, at: true, data: true, setterId: true } }),
    prisma.dmLog.findMany({
      where: { workspaceId, instagramAccountId: contact.instagramAccountId, commenterId: contact.igUserId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, matchedKeyword: true, createdAt: true },
    }),
    prisma.contactFieldValue.findMany({ where: { contactId, source: "j" }, select: { fieldId: true, value: true, updatedAt: true, field: { select: { label: true } } } }),
    prisma.setter.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
  ]);
  const resourceIds = events.map((e) => (e.data as { resourceId?: string } | null)?.resourceId).filter((v): v is string => Boolean(v));
  const resources = resourceIds.length ? await prisma.resource.findMany({ where: { id: { in: resourceIds } }, select: { id: true, name: true } }) : [];
  const setterName = (id: string | null) => setters.find((s) => s.id === id)?.name ?? null;
  const currency = events.some((e) => e.kind === "won") ? await (await import("@/lib/os/won")).workspaceCurrency(workspaceId) : "EUR";

  const items: ActivityItem[] = [];
  for (const e of events) {
    if (e.kind === "keyword_trigger") continue; // the DmLog rows below carry the keyword
    const meta = EVENT_LABEL[e.kind];
    if (!meta) continue;
    const resourceId = (e.data as { resourceId?: string } | null)?.resourceId;
    items.push({
      id: e.id,
      kind: meta.kind,
      label: meta.label,
      detail: e.kind === "won" ? wonDetail(e.data, currency) : resourceId ? (resources.find((r) => r.id === resourceId)?.name ?? null) : null,
      at: e.at.toISOString(),
      by: setterName(e.setterId),
    });
  }
  for (const l of logs) {
    items.push({ id: l.id, kind: "keyword", label: l.matchedKeyword ? `Triggered ${l.matchedKeyword.toUpperCase()}` : "Commented", detail: null, at: l.createdAt.toISOString(), by: "OpenReply" });
  }
  for (const v of values) {
    items.push({ id: `f-${v.fieldId}`, kind: "field", label: `Filled ${v.field.label}`, detail: v.value, at: v.updatedAt.toISOString(), by: "J" });
  }
  return sortActivity(items).slice(0, limit);
}
