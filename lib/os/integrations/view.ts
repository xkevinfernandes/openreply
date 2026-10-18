// What the Integrations screen and the contact panel show.
import { prisma } from "@/lib/db/client";
import { normalizeMapping, type FieldMapping, type SyncProviderId } from "./mapping";
import { PROVIDER_INFO } from "./view-info";

export { PROVIDER_INFO, type IntegrationCategory } from "./view-info";

export interface SyncError {
  contactId: string;
  name: string;
  error: string;
  at: string | null;
}

export interface IntegrationView {
  provider: SyncProviderId;
  connected: boolean;
  enabled: boolean;
  mapping: FieldMapping;
  locationId: string | null;
  lastTestedAt: string | null;
  lastError: string | null;
  synced: number;
  failing: number;
  lastSyncedAt: string | null;
  errors: SyncError[];
}

export async function integrationsView(workspaceId: string): Promise<IntegrationView[]> {
  const [kitConn, rows, counts, errors, last] = await Promise.all([
    prisma.crmConnection.findUnique({ where: { workspaceId_provider: { workspaceId, provider: "KIT" } }, select: { id: true } }),
    prisma.osIntegration.findMany({ where: { workspaceId } }),
    prisma.contactSync.groupBy({ by: ["provider"], where: { workspaceId, lastSyncedAt: { not: null } }, _count: { _all: true } }),
    prisma.contactSync.findMany({
      where: { workspaceId, lastError: { not: null } },
      orderBy: { lastErrorAt: "desc" },
      take: 20,
      select: { provider: true, contactId: true, lastError: true, lastErrorAt: true, contact: { select: { username: true, fullName: true } } },
    }),
    prisma.contactSync.groupBy({ by: ["provider"], where: { workspaceId }, _max: { lastSyncedAt: true } }),
  ]);
  return (["kit", "ghl"] as const).map((provider) => {
    const row = rows.find((r) => r.provider === provider);
    const mine = errors.filter((e) => e.provider === provider);
    const lastAt = last.find((l) => l.provider === provider)?._max.lastSyncedAt ?? null;
    return {
      provider,
      connected: provider === "kit" ? Boolean(kitConn) : Boolean(row?.credentials && row.locationId),
      enabled: row?.enabled ?? true,
      mapping: normalizeMapping(row?.mapping),
      locationId: row?.locationId ?? null,
      lastTestedAt: row?.lastTestedAt?.toISOString() ?? null,
      lastError: row?.lastError ?? null,
      synced: counts.find((c) => c.provider === provider)?._count._all ?? 0,
      failing: mine.length,
      lastSyncedAt: lastAt?.toISOString() ?? null,
      errors: mine.slice(0, 5).map((e) => ({
        contactId: e.contactId,
        name: e.contact.username ? `@${e.contact.username}` : (e.contact.fullName ?? "Contact"),
        error: e.lastError ?? "",
        at: e.lastErrorAt?.toISOString() ?? null,
      })),
    };
  });
}

export interface ContactSyncLine {
  provider: SyncProviderId;
  name: string;
  state: "synced" | "error" | "waiting";
  at: string | null;
  detail: string | null;
}

/** One line per connected provider for the contact panel. Cheap: one read. */
export async function contactSyncLines(workspaceId: string, contactId: string, connected: SyncProviderId[]): Promise<ContactSyncLine[]> {
  if (!connected.length) return [];
  const [rows, contact] = await Promise.all([
    prisma.contactSync.findMany({ where: { contactId, workspaceId } }),
    prisma.contact.findFirst({ where: { id: contactId, workspaceId }, select: { email: true } }),
  ]);
  return connected.map((provider) => {
    const row = rows.find((r) => r.provider === provider);
    const name = PROVIDER_INFO[provider].name;
    if (row?.lastError) return { provider, name, state: "error", at: row.lastErrorAt?.toISOString() ?? null, detail: row.lastError };
    if (row?.lastSyncedAt) return { provider, name, state: "synced", at: row.lastSyncedAt.toISOString(), detail: null };
    const detail = provider === "kit" && !contact?.email ? "Waits for an email" : "Not sent yet";
    return { provider, name, state: "waiting", at: null, detail };
  });
}
