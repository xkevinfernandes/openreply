// The Data OS connection on Settings › Integrations (Content). Data OS is an
// external system reached over HTTP (base URL + token), never tables copied
// in. Stored as OsIntegration(provider "dataos"): settings.baseUrl, and the
// token encrypted in credentials as {"token": "..."}. S2's client
// (lib/os/dataos) reads the same row.
import { prisma } from "@/lib/db/client";
import { decryptToken, encryptToken } from "@/lib/meta/oauth";
import { mockDataOs } from "@/lib/os/dataos/mock";
import { osMockEnabled } from "@/lib/os/mock";

export const DATAOS_PROVIDER = "dataos";

export interface DataOsView {
  connected: boolean;
  /** "mock" under OS_MOCK, else "http". */
  mode: string;
  baseUrl: string | null;
  enabled: boolean;
  lastTestedAt: string | null;
  lastError: string | null;
}

/** A base URL as stored: https, no trailing slash. */
export function cleanBaseUrl(raw: unknown): { url: string } | { error: string } {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return { error: "Paste the Data OS address." };
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") return { error: "Use an https address." };
    return { url: u.toString().replace(/\/+$/, "") };
  } catch {
    return { error: "That isn't an address." };
  }
}

export async function dataOsView(workspaceId: string): Promise<DataOsView> {
  const row = await prisma.osIntegration.findUnique({ where: { workspaceId_provider: { workspaceId, provider: DATAOS_PROVIDER } } });
  const baseUrl = (row?.settings as { baseUrl?: string } | null)?.baseUrl ?? null;
  if (!row && osMockEnabled()) {
    const s = await mockDataOs.status();
    return { connected: s.connected, mode: s.mode, baseUrl: null, enabled: true, lastTestedAt: null, lastError: null };
  }
  return {
    connected: Boolean(row && baseUrl),
    mode: "http",
    baseUrl,
    enabled: row?.enabled ?? true,
    lastTestedAt: row?.lastTestedAt?.toISOString() ?? null,
    lastError: row?.lastError ?? null,
  };
}

/** Save the address and (optionally new) token. An empty token keeps the old one. */
export async function saveDataOs(workspaceId: string, input: { baseUrl: unknown; token?: unknown }): Promise<{ ok: true } | { error: string }> {
  const url = cleanBaseUrl(input.baseUrl);
  if ("error" in url) return url;
  const token = typeof input.token === "string" ? input.token.trim() : "";
  if (token.length > 500) return { error: "That token is too long." };
  const existing = await prisma.osIntegration.findUnique({ where: { workspaceId_provider: { workspaceId, provider: DATAOS_PROVIDER } }, select: { credentials: true } });
  const credentials = token ? encryptToken(JSON.stringify({ token })) : (existing?.credentials ?? null);
  await prisma.osIntegration.upsert({
    where: { workspaceId_provider: { workspaceId, provider: DATAOS_PROVIDER } },
    create: { workspaceId, provider: DATAOS_PROVIDER, credentials, settings: { baseUrl: url.url }, enabled: true },
    update: { credentials, settings: { baseUrl: url.url }, enabled: true, lastError: null },
  });
  return { ok: true };
}

export async function disconnectDataOs(workspaceId: string): Promise<void> {
  await prisma.osIntegration.deleteMany({ where: { workspaceId, provider: DATAOS_PROVIDER } });
}

/** For S2's HTTP client: the address and token, or null when not connected. */
export async function dataOsCredentials(workspaceId: string): Promise<{ baseUrl: string; token: string | null } | null> {
  const row = await prisma.osIntegration.findUnique({ where: { workspaceId_provider: { workspaceId, provider: DATAOS_PROVIDER } } });
  const baseUrl = (row?.settings as { baseUrl?: string } | null)?.baseUrl;
  if (!row || !baseUrl || !row.enabled) return null;
  let token: string | null = null;
  try {
    token = row.credentials ? ((JSON.parse(decryptToken(row.credentials)) as { token?: string }).token ?? null) : null;
  } catch {
    token = null;
  }
  return { baseUrl, token };
}
