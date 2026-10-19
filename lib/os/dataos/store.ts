// The one Data OS connection store: OsIntegration(provider "dataos") with the
// base URL in settings and the token encrypted in credentials. Settings ›
// Integrations (lib/os/integrations/dataos.ts) and the media worker both use it.

import { prisma } from "@/lib/db/client";
import { decryptToken, encryptToken } from "@/lib/meta/oauth";
import { createHttpDataOs } from "@/lib/os/dataos/http";
import { mockDataOs } from "@/lib/os/dataos/mock";
import type { DataOs } from "@/lib/os/dataos/types";
import { osMockEnabled } from "@/lib/os/mock";

export const DATAOS_PROVIDER = "dataos";

export interface DataOsConnection {
  connected: boolean;
  baseUrl: string | null;
  enabled: boolean;
  lastTestedAt: string | null;
  lastError: string | null;
  mode: "mock" | "http" | "none";
}

function baseUrlOf(settings: unknown): string | null {
  const v = settings && typeof settings === "object" ? (settings as { baseUrl?: unknown }).baseUrl : null;
  return typeof v === "string" && v ? v : null;
}

function tokenOf(credentials: string | null): string | null {
  if (!credentials) return null;
  try {
    const t = (JSON.parse(decryptToken(credentials)) as { token?: unknown }).token;
    return typeof t === "string" && t ? t : null;
  } catch {
    return null;
  }
}

/** The workspace's Data OS, or null when none is connected (mock in OS_MOCK). */
export async function dataOsFor(workspaceId: string): Promise<DataOs | null> {
  if (osMockEnabled()) return mockDataOs;
  const row = await prisma.osIntegration.findUnique({ where: { workspaceId_provider: { workspaceId, provider: DATAOS_PROVIDER } } }).catch(() => null);
  if (!row || !row.enabled) return null;
  const baseUrl = baseUrlOf(row.settings);
  const token = tokenOf(row.credentials);
  if (!baseUrl || !token) return null;
  return createHttpDataOs({ baseUrl, token });
}

export async function getDataOsConnection(workspaceId: string): Promise<DataOsConnection> {
  if (osMockEnabled()) return { connected: true, baseUrl: null, enabled: true, lastTestedAt: null, lastError: null, mode: "mock" };
  const row = await prisma.osIntegration.findUnique({ where: { workspaceId_provider: { workspaceId, provider: DATAOS_PROVIDER } } });
  const baseUrl = baseUrlOf(row?.settings);
  const connected = Boolean(row && baseUrl && row.credentials);
  return {
    connected,
    baseUrl,
    enabled: row?.enabled ?? false,
    lastTestedAt: row?.lastTestedAt?.toISOString() ?? null,
    lastError: row?.lastError ?? null,
    mode: connected ? "http" : "none",
  };
}

/** Write URL + token without a network test. A blank token keeps the old one. */
export async function writeDataOsConnection(workspaceId: string, input: { baseUrl: string; token?: string | null }): Promise<void> {
  const existing = await prisma.osIntegration.findUnique({ where: { workspaceId_provider: { workspaceId, provider: DATAOS_PROVIDER } }, select: { credentials: true } });
  const token = input.token?.trim();
  const credentials = token ? encryptToken(JSON.stringify({ token })) : (existing?.credentials ?? null);
  const data = { credentials, settings: { baseUrl: input.baseUrl }, enabled: true, lastError: null };
  await prisma.osIntegration.upsert({
    where: { workspaceId_provider: { workspaceId, provider: DATAOS_PROVIDER } },
    create: { workspaceId, provider: DATAOS_PROVIDER, ...data },
    update: data,
  });
}

export async function disconnectDataOs(workspaceId: string): Promise<void> {
  if (osMockEnabled()) return;
  await prisma.osIntegration.deleteMany({ where: { workspaceId, provider: DATAOS_PROVIDER } });
}
