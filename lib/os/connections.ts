// One source of truth for "what is connected": the Instagram account (and its
// webhook), Zernio, Kit, Cal.com and today's sends against the cap. Settings'
// section list, Settings › Instagram account, Integrations, Diagnostics and the
// sidebar all read from here, so they can't disagree.
//
// OS_MOCK=1: Instagram is @claudepreneur through Zernio with its webhook not
// subscribed (the Diagnostics canvas's one problem). "Fix webhook" clears it
// in memory. Nothing calls Instagram or Zernio. Kit and Cal.com come from the
// local database like any workspace (not connected unless a tester connects
// them), and sends today come from the send cap's own count.

import { prisma } from "@/lib/db/client";
import { osMockEnabled } from "@/lib/os/mock";

export * from "@/lib/os/connections-view";
import { instagramProblems, type InstagramAccountState, type InstagramState, type ZernioState } from "@/lib/os/connections-view";

// --- OS_MOCK sample ------------------------------------------------------------------

const mem: { webhookFixed: boolean } = ((globalThis as { __osMockConnections?: { webhookFixed: boolean } }).__osMockConnections ??= { webhookFixed: false });

export function mockInstagramState(now = new Date()): InstagramState {
  const account: InstagramAccountState = {
    id: null,
    username: "claudepreneur",
    provider: "ZERNIO",
    tokenExpiresAt: null,
    zernioAccountId: "sample",
    webhookSubscribed: mem.webhookFixed,
    automations: 0,
    connectedAt: null,
  };
  const zernio = { configured: true, webhookReady: true };
  return { account, zernio, problems: instagramProblems(account, zernio, now), sample: true };
}

/** OS_MOCK: "Fix webhook" on the sample account. */
export function fixMockWebhook(): void {
  mem.webhookFixed = true;
}

/** Tests: back to the sample's starting state. */
export function resetMockConnections(): void {
  mem.webhookFixed = false;
}

// --- Reads ------------------------------------------------------------------------------

export async function readZernio(workspaceId: string): Promise<ZernioState> {
  if (osMockEnabled()) return mockInstagramState().zernio;
  const row = await prisma.zernioConnection.findUnique({ where: { workspaceId }, select: { webhookId: true } });
  return { configured: Boolean(row), webhookReady: Boolean(row?.webhookId) };
}

/** The workspace's newest Instagram account, Zernio and the problems. */
export async function readInstagram(workspaceId: string, now = new Date()): Promise<InstagramState> {
  if (osMockEnabled()) return mockInstagramState(now);
  const [row, zernio] = await Promise.all([
    prisma.instagramAccount.findFirst({
      where: { workspaceId },
      orderBy: { connectedAt: "desc" },
      select: {
        id: true,
        username: true,
        provider: true,
        tokenExpiresAt: true,
        webhookSubscribed: true,
        zernioAccountId: true,
        connectedAt: true,
        _count: { select: { automations: true } },
      },
    }),
    readZernio(workspaceId),
  ]);
  const account: InstagramAccountState | null = row
    ? {
        id: row.id,
        username: row.username,
        provider: row.provider,
        tokenExpiresAt: row.tokenExpiresAt,
        zernioAccountId: row.zernioAccountId,
        webhookSubscribed: row.webhookSubscribed,
        automations: row._count.automations,
        connectedAt: row.connectedAt,
      }
    : null;
  return { account, zernio, problems: instagramProblems(account, zernio, now), sample: false };
}

export interface KitState {
  connected: boolean;
  lastSyncedAt: Date | null;
  errors: number;
  lastError: string | null;
}

export async function readKit(workspaceId: string): Promise<KitState> {
  const [conn, row, last, errors] = await Promise.all([
    prisma.crmConnection.findUnique({ where: { workspaceId_provider: { workspaceId, provider: "KIT" } }, select: { id: true } }),
    prisma.osIntegration.findFirst({ where: { workspaceId, provider: "kit" }, select: { lastError: true } }),
    prisma.contactSync.aggregate({ where: { workspaceId, provider: "kit" }, _max: { lastSyncedAt: true } }),
    prisma.contactSync.count({ where: { workspaceId, provider: "kit", lastError: { not: null } } }),
  ]);
  return { connected: Boolean(conn), lastSyncedAt: last._max.lastSyncedAt ?? null, errors, lastError: row?.lastError ?? null };
}

export interface CalcomState {
  connected: boolean;
  lastError: string | null;
  lastBookingAt: Date | null;
}

export async function readCalcom(workspaceId: string): Promise<CalcomState> {
  const [row, last] = await Promise.all([
    prisma.osIntegration.findFirst({ where: { workspaceId, provider: "calcom" }, select: { credentials: true, lastError: true } }),
    prisma.booking.findFirst({ where: { workspaceId, provider: "calcom" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  return { connected: Boolean(row?.credentials), lastError: row?.lastError ?? null, lastBookingAt: last?.createdAt ?? null };
}

export interface SendsState {
  sent: number;
  cap: number;
  pausedAll: boolean;
}

/** J's sends today against the cap: the sidebar and Diagnostics both show this. */
export async function readSends(workspaceId: string): Promise<SendsState> {
  const { capState } = await import("@/lib/os/sending/cap");
  const s = await capState(workspaceId);
  return { sent: s.sentToday, cap: s.cap, pausedAll: s.pausedAll };
}
