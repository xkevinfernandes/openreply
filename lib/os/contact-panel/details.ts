// Details tab data (ContactsD): fields n/m with who filled them, CRM sync
// state, Kit tags and lead magnets sent. Keywords come from the panel head
// (load.ts). Owner: S3.
import { prisma } from "@/lib/db/client";
import { listCustomFields } from "@/lib/os/fields/store";
import type { CustomFieldView, DetailsField, FieldValueSource } from "@/lib/os/fields/types";
import { contactSyncLines } from "@/lib/os/integrations/view";
import type { SyncProviderId } from "@/lib/os/integrations/mapping";
import { mockContact, mockContactExtras, osMockEnabled } from "@/lib/os/mock";
import { mockFieldValues, mockLeadMagnets, mockSync } from "@/lib/os/mock-contacts";
import { defaultSetterId } from "@/lib/os/setter/setters";

export interface DetailsSync {
  provider: SyncProviderId;
  name: string;
  /** off = not connected (shows Connect). */
  state: "synced" | "error" | "waiting" | "off";
  at: string | null;
  detail: string | null;
}

export interface LeadMagnetSent {
  name: string;
  /** openreply = the keyword opener's button card; setter = a link J sent. */
  via: "openreply" | "setter";
  at: string | null;
}

export interface ContactDetailsData {
  contactId: string;
  setterName: string | null;
  fields: DetailsField[];
  filled: number;
  sync: DetailsSync[];
  tags: string[];
  /** Kit has them as a subscriber. */
  kitSubscribed: boolean;
  leadMagnets: LeadMagnetSent[];
}

const PROVIDER_NAMES: Record<SyncProviderId, string> = { kit: "Kit", ghl: "GoHighLevel" };

/**
 * The rows the Fields block shows: the setter's fields (all fields when the
 * setter has no list), in Settings order, with the value and who set it.
 * first_name / email fall back to the Instagram name and the contact email.
 */
export function detailsFields(
  fields: CustomFieldView[],
  setterId: string | null,
  values: Map<string, { value: string; source: FieldValueSource | "instagram"; at: string | null }>,
  builtins: { first_name?: string | null; email?: string | null }
): DetailsField[] {
  const mine = setterId ? fields.filter((f) => f.usedBy.includes(setterId)) : [];
  const shown = (mine.length ? mine : fields).slice().sort((a, b) => a.sortOrder - b.sortOrder);
  return shown.map((f) => {
    const v = values.get(f.key);
    const builtin = f.key === "first_name" ? builtins.first_name : f.key === "email" ? builtins.email : null;
    return {
      fieldId: f.id,
      key: f.key,
      label: f.label,
      type: f.type,
      options: f.options,
      value: v?.value ?? builtin ?? null,
      source: v?.source ?? (builtin ? (f.key === "first_name" ? "instagram" : "import") : null),
      at: v?.at ?? null,
      bySetter: setterId ? f.usedBy.includes(setterId) : false,
    };
  });
}

/** Lead magnets, once each, oldest first. */
export function mergeLeadMagnets(items: LeadMagnetSent[]): LeadMagnetSent[] {
  const seen = new Map<string, LeadMagnetSent>();
  for (const it of [...items].sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""))) if (!seen.has(it.name)) seen.set(it.name, it);
  return [...seen.values()];
}

async function mockDetails(workspaceId: string, contactId: string): Promise<ContactDetailsData> {
  const who = mockContact(contactId);
  const fields = await listCustomFields(workspaceId).catch(() => []);
  const j = await prisma.setter.findFirst({ where: { workspaceId, name: "J" }, select: { id: true } }).catch(() => null);
  const setterId = who?.contact.kind === "SALES" ? (j?.id ?? null) : null;
  const vals = mockFieldValues(contactId);
  const rows = detailsFields(fields, setterId, new Map(Object.entries(vals).map(([k, v]) => [k, v])), {
    first_name: who?.fullName?.split(/\s+/)[0] ?? null,
    email: mockContactExtras(contactId).email,
  });
  const kit = mockSync(contactId).kit;
  return {
    contactId,
    setterName: setterId ? "J" : null,
    fields: rows,
    filled: rows.filter((f) => f.value).length,
    sync: [
      { provider: "kit", name: "Kit", state: kit.state, at: kit.at, detail: kit.state === "waiting" ? "Waits for an email" : null },
      { provider: "ghl", name: "GoHighLevel", state: "off", at: null, detail: null },
    ],
    tags: mockContactExtras(contactId).tags,
    kitSubscribed: kit.state === "synced",
    leadMagnets: mockLeadMagnets(contactId),
  };
}

async function leadMagnetsFor(workspaceId: string, contact: { id: string; igUserId: string; instagramAccountId: string }): Promise<LeadMagnetSent[]> {
  const [events, logs] = await Promise.all([
    prisma.osEvent.findMany({ where: { workspaceId, contactId: contact.id, kind: "lead_magnet_sent" }, orderBy: { at: "asc" }, select: { at: true, data: true } }),
    prisma.dmLog.findMany({
      where: { workspaceId, instagramAccountId: contact.instagramAccountId, commenterId: contact.igUserId, status: "SENT" },
      orderBy: { createdAt: "asc" },
      select: { automationId: true, dmSentAt: true, createdAt: true },
      take: 20,
    }),
  ]);
  const maps = logs.length ? await prisma.campaignResource.findMany({ where: { automationId: { in: [...new Set(logs.map((l) => l.automationId))] } } }) : [];
  const resourceIds = [
    ...new Set([...events.map((e) => (e.data as { resourceId?: string } | null)?.resourceId).filter((v): v is string => Boolean(v)), ...maps.map((m) => m.resourceId)]),
  ];
  const resources = resourceIds.length ? await prisma.resource.findMany({ where: { id: { in: resourceIds } }, select: { id: true, name: true } }) : [];
  const name = (id: string | undefined) => resources.find((r) => r.id === id)?.name ?? null;
  const out: LeadMagnetSent[] = [];
  for (const l of logs) {
    const n = name(maps.find((m) => m.automationId === l.automationId)?.resourceId);
    if (n) out.push({ name: n, via: "openreply", at: (l.dmSentAt ?? l.createdAt).toISOString() });
  }
  for (const e of events) {
    const n = name((e.data as { resourceId?: string } | null)?.resourceId);
    if (n) out.push({ name: n, via: "setter", at: e.at.toISOString() });
  }
  return mergeLeadMagnets(out);
}

export async function loadContactDetails(workspaceId: string, contactId: string): Promise<ContactDetailsData> {
  if (osMockEnabled()) return mockDetails(workspaceId, contactId);

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, workspaceId },
    select: { id: true, setterId: true, instagramAccountId: true, igUserId: true, fullName: true, email: true, tags: true },
  });
  if (!contact) return { contactId, setterName: null, fields: [], filled: 0, sync: [], tags: [], kitSubscribed: false, leadMagnets: [] };

  const setterId = contact.setterId ?? (await defaultSetterId(workspaceId, contact.instagramAccountId));
  const [setter, fields, values, kitConn, ghlRow, leadMagnets] = await Promise.all([
    setterId ? prisma.setter.findFirst({ where: { id: setterId, workspaceId }, select: { name: true } }) : null,
    listCustomFields(workspaceId),
    prisma.contactFieldValue.findMany({ where: { contactId }, select: { value: true, source: true, updatedAt: true, field: { select: { key: true } } } }),
    prisma.crmConnection.findUnique({ where: { workspaceId_provider: { workspaceId, provider: "KIT" } }, select: { id: true } }),
    prisma.osIntegration.findUnique({ where: { workspaceId_provider: { workspaceId, provider: "ghl" } }, select: { credentials: true, locationId: true } }),
    leadMagnetsFor(workspaceId, contact),
  ]);

  const connected: SyncProviderId[] = [...(kitConn ? (["kit"] as const) : []), ...(ghlRow?.credentials && ghlRow.locationId ? (["ghl"] as const) : [])];
  const lines = await contactSyncLines(workspaceId, contactId, connected);
  const sync: DetailsSync[] = (["kit", "ghl"] as const).map((p) => {
    const l = lines.find((x) => x.provider === p);
    return l ? { provider: p, name: l.name, state: l.state, at: l.at, detail: l.detail } : { provider: p, name: PROVIDER_NAMES[p], state: "off", at: null, detail: null };
  });

  const rows = detailsFields(
    fields,
    setterId,
    new Map(values.map((v) => [v.field.key, { value: v.value, source: v.source as FieldValueSource, at: v.updatedAt.toISOString() }])),
    { first_name: contact.fullName?.split(/\s+/)[0] ?? null, email: contact.email }
  );
  return {
    contactId,
    setterName: setter?.name ?? null,
    fields: rows,
    filled: rows.filter((f) => f.value).length,
    sync,
    tags: contact.tags,
    kitSubscribed: sync.some((s) => s.provider === "kit" && s.state === "synced"),
    leadMagnets,
  };
}
