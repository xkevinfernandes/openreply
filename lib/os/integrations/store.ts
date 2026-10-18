// DB side of the sync: provider configs, the contact snapshot, the sync log.
import { prisma } from "@/lib/db/client";
import { decryptToken, encryptToken } from "@/lib/meta/oauth";
import { createGhlSync, type GhlCredentials } from "./ghl";
import { createKitSync } from "./kit";
import { normalizeMapping, qualificationFromDrafts, type ContactSnapshot, type FieldMapping, type SyncProviderId } from "./mapping";
import type { PushedState, SyncProvider } from "./provider";

export interface ProviderConfig {
  provider: SyncProviderId;
  client: SyncProvider;
  mapping: FieldMapping;
  enabled: boolean;
}

export function encryptGhl(creds: GhlCredentials) {
  return encryptToken(JSON.stringify({ token: creds.token }));
}

function ghlCredentials(row: { credentials: string | null; locationId: string | null }): GhlCredentials | null {
  if (!row.credentials || !row.locationId) return null;
  try {
    const parsed = JSON.parse(decryptToken(row.credentials)) as { token?: string };
    return parsed.token ? { token: parsed.token, locationId: row.locationId } : null;
  } catch {
    return null;
  }
}

/** One provider's live config, or null when it isn't connected. */
export async function loadProvider(workspaceId: string, provider: SyncProviderId): Promise<ProviderConfig | null> {
  const row = await prisma.osIntegration.findUnique({ where: { workspaceId_provider: { workspaceId, provider } } });
  if (provider === "kit") {
    const conn = await prisma.crmConnection.findUnique({ where: { workspaceId_provider: { workspaceId, provider: "KIT" } } });
    if (!conn) return null;
    return { provider, client: createKitSync(decryptToken(conn.apiKey)), mapping: normalizeMapping(row?.mapping), enabled: row?.enabled ?? true };
  }
  const creds = row ? ghlCredentials(row) : null;
  if (!row || !creds) return null;
  return { provider, client: createGhlSync(creds), mapping: normalizeMapping(row.mapping), enabled: row.enabled };
}

/** Providers events should go to: connected and not paused. */
export async function activeProviders(workspaceId: string): Promise<SyncProviderId[]> {
  const [kit, rows] = await Promise.all([
    prisma.crmConnection.findUnique({ where: { workspaceId_provider: { workspaceId, provider: "KIT" } }, select: { id: true } }),
    prisma.osIntegration.findMany({ where: { workspaceId }, select: { provider: true, enabled: true, credentials: true, locationId: true } }),
  ]);
  const out: SyncProviderId[] = [];
  const kitRow = rows.find((r) => r.provider === "kit");
  if (kit && (kitRow?.enabled ?? true)) out.push("kit");
  const ghl = rows.find((r) => r.provider === "ghl");
  if (ghl?.enabled && ghl.credentials && ghl.locationId) out.push("ghl");
  return out;
}

export async function contactSnapshot(contactId: string, workspaceId: string): Promise<ContactSnapshot | null> {
  const c = await prisma.contact.findFirst({
    where: { id: contactId, workspaceId },
    select: { id: true, kind: true, stage: true, username: true, fullName: true, email: true, tags: true },
  });
  if (!c) return null;
  const drafts = await prisma.draft.findMany({
    where: { contactId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { raw: true },
  });
  return { ...c, qualification: qualificationFromDrafts(drafts.map((d) => d.raw)) };
}

export interface SyncLogRow extends PushedState {
  lastHash: string | null;
  lastError: string | null;
}

export async function getSyncLog(contactId: string, provider: SyncProviderId): Promise<SyncLogRow | null> {
  return prisma.contactSync.findUnique({
    where: { contactId_provider: { contactId, provider } },
    select: { externalId: true, pushedTags: true, lastHash: true, lastError: true },
  });
}

export async function recordSuccess(
  key: { workspaceId: string; contactId: string; provider: SyncProviderId },
  data: PushedState & { hash: string; event: string }
) {
  const row = { externalId: data.externalId, pushedTags: data.pushedTags, lastHash: data.hash, lastEvent: data.event, lastSyncedAt: new Date(), lastError: null, lastErrorAt: null };
  await prisma.contactSync.upsert({
    where: { contactId_provider: { contactId: key.contactId, provider: key.provider } },
    create: { ...key, ...row },
    update: row,
  });
}

export async function recordFailure(key: { workspaceId: string; contactId: string; provider: SyncProviderId }, error: string, event: string) {
  const row = { lastError: error.slice(0, 300), lastErrorAt: new Date(), lastEvent: event };
  await prisma.contactSync.upsert({
    where: { contactId_provider: { contactId: key.contactId, provider: key.provider } },
    create: { ...key, pushedTags: [], ...row },
    update: row,
  });
}
