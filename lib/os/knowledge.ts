// Read side of the Knowledge bases screens: plain serialisable views for the
// pages and client components. Writes are in app/(os)/os/knowledge/actions.ts.

import { prisma } from "@/lib/db/client";
import { connectedCalendar } from "@/lib/os/integrations/calendar/store";
import { bookingOf, type SetterBooking } from "@/lib/os/integrations/calendar/setter-booking";
import { calendarName } from "@/lib/os/integrations/calendar/types";
import { bookingLinkOf, type ClientSettings, type FunnelStage, type VoiceCorrection } from "@/lib/os/setter/profile";
import { profileFromRow, type ResourceStatusName } from "@/lib/os/setter/kb";
import { docCount, type DocKey } from "@/lib/os/setter/knowledge/docs";
import { ensureDocs, loadDocViews, type DocRevisionView } from "@/lib/os/setter/knowledge/doc-store";
import { resolveSequenceSet, type SequenceSet } from "@/lib/os/sequences/types";
import { VOICE_SLOTS } from "@/lib/os/voice/slots";

export type ResourceKind = "resource" | "setter" | "episode";

export interface ResourceView {
  id: string;
  slug: string;
  kind: ResourceKind;
  name: string;
  link: string | null;
  keyword: string | null;
  status: ResourceStatusName;
  description: string;
  /** How many setters may offer it. */
  setterCount: number;
  /** Resource.keyword plus the keywords of campaigns mapped to it. */
  keywords: { word: string; automationId: string | null }[];
  usedBy: { id: string; name: string }[];
  /** Times it went out (OsEvent lead_magnet_sent). */
  sent: number;
  /** Episodes: when J shares it. */
  when: string;
  sortOrder: number;
}

export interface SetterCard {
  id: string;
  name: string;
  isDefault: boolean;
  defaultFor: string | null;
  openOffers: number;
  offers: number;
  leadMagnets: number;
  corrections: number;
  campaigns: number;
  updatedAt: string;
}

export const kindOf = (k: string): ResourceKind => (k === "setter" ? "setter" : k === "episode" ? "episode" : "resource");

export function keywordsFor(
  r: { id: string; keyword: string | null; data?: unknown },
  maps: { automationId: string; resourceId: string }[],
  automations: { id: string; keywords: string[] }[]
): { word: string; automationId: string | null }[] {
  const out = new Map<string, { word: string; automationId: string | null }>();
  for (const w of (r.keyword ?? "").split(/[,\s]+/)) if (w.trim()) out.set(w.trim().toUpperCase(), { word: w.trim().toUpperCase(), automationId: null });
  const extra = r.data && typeof r.data === "object" ? (r.data as { keywords?: unknown }).keywords : null;
  if (Array.isArray(extra)) for (const w of extra) if (typeof w === "string" && w.trim()) out.set(w.trim().toUpperCase(), { word: w.trim().toUpperCase(), automationId: null });
  for (const m of maps.filter((x) => x.resourceId === r.id)) {
    const a = automations.find((x) => x.id === m.automationId);
    for (const w of a?.keywords ?? []) if (w.trim()) out.set(w.trim().toUpperCase(), { word: w.trim().toUpperCase(), automationId: a!.id });
  }
  return [...out.values()];
}

export function sentCounts(events: { data: unknown }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of events) {
    const id = e.data && typeof e.data === "object" ? (e.data as { resourceId?: unknown }).resourceId : null;
    if (typeof id === "string") out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

export async function listResources(workspaceId: string): Promise<ResourceView[]> {
  const [rows, maps, events] = await Promise.all([
    prisma.resource.findMany({
      where: { workspaceId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { setters: { select: { setter: { select: { id: true, name: true } } } } },
    }),
    prisma.campaignResource.findMany({ where: { workspaceId }, select: { automationId: true, resourceId: true } }).catch(() => []),
    prisma.osEvent.findMany({ where: { workspaceId, kind: "lead_magnet_sent" }, select: { data: true } }).catch(() => []),
  ]);
  const automations = maps.length
    ? await prisma.automation.findMany({ where: { workspaceId, id: { in: maps.map((m) => m.automationId) } }, select: { id: true, keywords: true } }).catch(() => [])
    : [];
  const sent = sentCounts(events);
  return rows.map((r) => {
    const data = (r.data && typeof r.data === "object" ? r.data : {}) as { when?: unknown };
    return {
      id: r.id,
      slug: r.slug,
      kind: kindOf(r.kind),
      name: r.name,
      link: r.link,
      keyword: r.keyword,
      status: r.status,
      description: r.description,
      setterCount: r.setters.length,
      keywords: keywordsFor(r, maps, automations),
      usedBy: r.setters.map((s) => s.setter),
      sent: sent.get(r.id) ?? 0,
      when: typeof data.when === "string" ? data.when : "",
      sortOrder: r.sortOrder,
    };
  });
}

// ---------------------------------------------------------------- one setter
export interface DocFileView {
  key: DocKey;
  body: string;
  updatedAt: string | null;
  count: number | null;
  revisions: DocRevisionView[];
}

export interface FieldPick {
  id: string;
  key: string;
  label: string;
  type: string;
  builtIn: boolean;
  ghl: boolean;
  kit: boolean;
  on: boolean;
  /** Other setters that fill it. */
  usedBy: string[];
}

export interface BookingView extends SetterBooking {
  configured: boolean;
  /** What J sends when nothing is set here (Business.md or the old setting). */
  inheritedLink: string;
  calendar: {
    provider: string;
    eventName: string | null;
    durationMinutes: number | null;
    hours: string;
    timezone: string;
    minNoticeHours: number;
  } | null;
}

export interface SetterEditorView {
  id: string;
  name: string;
  autonomy: "approve" | "auto";
  isDefault: boolean;
  instagramAccountId: string | null;
  settings: ClientSettings;
  funnel: FunnelStage[];
  voiceCorrections: VoiceCorrection[];
  docs: DocFileView[];
  setters: { id: string; name: string }[];
  enabledResourceIds: string[];
  resources: ResourceView[];
  accounts: { id: string; username: string }[];
  /** Follow-up sequences (lib/os/sequences), defaults filled in. */
  sequences: SequenceSet;
  fields: FieldPick[];
  booking: BookingView;
  testsRunning: number;
  voice: { recorded: number; total: number };
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** [1,2,3,4,5] → "Mon–Fri". */
export function daysLabel(days: number[]): string {
  const d = [...days].sort();
  if (!d.length) return "No days";
  const contiguous = d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  return contiguous && d.length > 2 ? `${DAY[d[0]]}–${DAY[d[d.length - 1]]}` : d.map((x) => DAY[x]).join(", ");
}

export async function loadSetterEditor(workspaceId: string, setterId: string): Promise<SetterEditorView | null> {
  const s = await prisma.setter.findFirst({ where: { id: setterId, workspaceId }, include: { resources: { select: { resourceId: true } } } });
  if (!s) return null;
  // The one-time JSON → docs import, lazily on first open.
  await ensureDocs(s).catch((err) => console.error("[OS Knowledge] docs import failed:", err));
  const [docs, resources, accounts, setters, sequenceRows, fieldRows, cal, testsRunning, clips] = await Promise.all([
    loadDocViews(s.id),
    listResources(workspaceId),
    prisma.instagramAccount.findMany({ where: { workspaceId }, select: { id: true, username: true }, orderBy: { connectedAt: "asc" } }),
    prisma.setter.findMany({ where: { workspaceId }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
    prisma.followupSequence.findMany({ where: { setterId, workspaceId } }),
    prisma.customField.findMany({ where: { workspaceId }, orderBy: { sortOrder: "asc" }, include: { setters: { select: { setterId: true } } } }).catch(() => []),
    connectedCalendar(workspaceId, s.id).catch(() => null),
    prisma.experiment.count({ where: { workspaceId, status: "RUNNING", OR: [{ setterId: s.id }, { setterId: null }] } }).catch(() => 0),
    prisma.voiceClip.findMany({ where: { setterId: s.id, slot: { not: null } }, select: { slot: true, audioId: true } }).catch(() => [] as { slot: string | null; audioId: string | null }[]),
  ]);
  const nameOf = new Map(setters.map((x) => [x.id, x.name]));
  const profile = profileFromRow(s, Object.fromEntries(docs.filter((d) => d.updatedAt).map((d) => [d.key, d.body])));
  const booking = bookingOf(s.settings);
  return {
    id: s.id,
    name: s.name,
    autonomy: s.autonomy === "AUTO" ? "auto" : "approve",
    isDefault: s.isDefault,
    instagramAccountId: s.instagramAccountId,
    settings: profile.settings,
    funnel: profile.funnel,
    voiceCorrections: profile.voiceCorrections,
    docs: docs.map((d) => ({ ...d, count: docCount(d.key, d.body) })),
    setters,
    enabledResourceIds: s.resources.map((r) => r.resourceId),
    resources,
    accounts,
    sequences: resolveSequenceSet(sequenceRows),
    fields: fieldRows.map((f) => ({
      id: f.id,
      key: f.key,
      label: f.label,
      type: f.type,
      builtIn: f.builtIn,
      ghl: Boolean(f.ghlField),
      kit: Boolean(f.kitField),
      on: f.setters.some((x) => x.setterId === s.id),
      usedBy: f.setters.filter((x) => x.setterId !== s.id).map((x) => nameOf.get(x.setterId) ?? "").filter(Boolean),
    })),
    booking: {
      ...booking,
      inheritedLink: bookingLinkOf(profile.settings) ? "" : profile.business.sections.booking_link || profile.settings.cal_com_url || "",
      calendar: cal
        ? {
            provider: calendarName(cal.provider),
            eventName: cal.eventName,
            durationMinutes: cal.durationMinutes,
            hours: `${daysLabel(cal.settings.workDays)} · ${hh(cal.settings.workStart)}–${hh(cal.settings.workEnd)}`,
            timezone: cal.settings.hostTimezone,
            minNoticeHours: cal.settings.minNoticeHours,
          }
        : null,
    },
    testsRunning,
    voice: { recorded: new Set(clips.filter((c) => c.audioId).map((c) => c.slot)).size, total: VOICE_SLOTS.length },
  };
}
