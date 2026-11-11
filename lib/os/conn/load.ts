// Reads what the database knows about each service into ServiceState (no
// words, no secrets except the last four characters, cut here on the server).
import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import type { InstagramState } from "@/lib/os/connections-view";
import type { CalendarBoard } from "@/lib/os/integrations/calendar/view";
import type { DataOsView } from "@/lib/os/integrations/dataos";
import type { IntegrationView } from "@/lib/os/integrations/view";
import { last4, SERVICES, type ServiceId } from "./catalog";
import { managedPresence } from "./health";
import type { ServiceEvent, ServiceState } from "./view";

export interface LoadInput {
  instagram: InstagramState;
  views: IntegrationView[];
  calendars: CalendarBoard;
  dataos: DataOsView;
}

/** A token's last four, decrypted on the server. JSON credentials ({token}) too. */
function tail(encrypted: string | null | undefined, json = false): string | undefined {
  if (!encrypted) return undefined;
  try {
    const plain = decryptToken(encrypted);
    return last4(json ? ((JSON.parse(plain) as { token?: string }).token ?? "") : plain);
  } catch {
    return undefined;
  }
}

const DAY = 86_400_000;

export async function loadServiceStates(workspaceId: string, input: LoadInput, now = new Date()): Promise<ServiceState[]> {
  const ids = SERVICES.map((s) => s.id);
  const [audit, events, zernio, kitRow, creds, lastDm, bookings] = await Promise.all([
    prisma.osConnection.findMany({ where: { workspaceId, service: { in: ids } } }).catch(() => []),
    prisma.osConnectionEvent.findMany({ where: { workspaceId }, orderBy: { at: "desc" }, take: 120 }).catch(() => []),
    prisma.zernioConnection.findUnique({ where: { workspaceId }, select: { apiKey: true, profileId: true, webhookId: true } }),
    prisma.crmConnection.findUnique({ where: { workspaceId_provider: { workspaceId, provider: "KIT" } }, select: { apiKey: true } }),
    prisma.osIntegration.findMany({ where: { workspaceId, provider: { in: ["ghl", "calcom", "calendly", "dataos"] } }, select: { provider: true, credentials: true } }),
    prisma.dmLog.findFirst({ where: { workspaceId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }).catch(() => null),
    prisma.booking
      .groupBy({ by: ["provider"], where: { workspaceId }, _max: { createdAt: true } })
      .catch(() => [] as { provider: string | null; _max: { createdAt: Date | null } }[]),
  ]);

  const userIds = [...new Set([...audit.map((a) => a.connectedById), ...events.map((e) => e.actorId)].filter((x): x is string => Boolean(x)))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [];
  const who = (id: string | null | undefined) => {
    const u = users.find((x) => x.id === id);
    return u ? (u.name?.trim() || u.email || null) : null;
  };
  const auditOf = (id: ServiceId) => audit.find((a) => a.service === id);
  const eventsOf = (id: ServiceId): ServiceEvent[] =>
    events.filter((e) => e.service === id).map((e) => ({ kind: e.kind, note: e.note, at: e.at, actor: who(e.actorId) }));
  const cred = (p: string) => creds.find((c) => c.provider === p)?.credentials ?? null;
  const bookedAt = (p: string) => bookings.find((b) => b.provider === p)?._max.createdAt ?? null;

  const states: ServiceState[] = [];
  const push = (s: ServiceState) => {
    const a = auditOf(s.id);
    // The last live check wins over the saved flags: a failed check is red.
    const checkError = a?.lastError && s.connected ? a.lastError : null;
    states.push({
      ...s,
      error: s.error ?? checkError,
      account: s.account ?? a?.account ?? null,
      connectedAt: a?.connectedAt ?? s.connectedAt ?? null,
      connectedBy: who(a?.connectedById),
      lastCheckedAt: a?.lastCheckedAt ?? s.lastCheckedAt ?? null,
      events: eventsOf(s.id),
    });
  };

  // Instagram
  const ig = input.instagram;
  const acct = ig.account;
  const expiresIn = acct?.tokenExpiresAt ? acct.tokenExpiresAt.getTime() - now.getTime() : null;
  push({
    id: "instagram",
    connected: Boolean(acct),
    account: acct ? `@${acct.username}${acct.provider === "ZERNIO" ? " (through Zernio)" : ""}` : null,
    error: ig.problems.find((p) => p.fix !== "webhook")?.text ?? null,
    attention:
      ig.problems.find((p) => p.fix === "webhook")?.text ??
      (expiresIn != null && expiresIn > 0 && expiresIn < 7 * DAY ? `The token expires in ${Math.max(1, Math.round(expiresIn / DAY))} days. Reconnect to renew it.` : null),
    connectedAt: acct?.connectedAt ?? null,
    lastUsedAt: lastDm?.createdAt ?? null,
  });

  // Zernio
  const zConfigured = ig.sample ? ig.zernio.configured : Boolean(zernio);
  push({
    id: "zernio",
    connected: zConfigured,
    last4: tail(zernio?.apiKey),
    attention: zConfigured && !zernio?.profileId && !ig.sample ? "Pick a Zernio profile to finish." : null,
    error: zConfigured && zernio?.profileId && !zernio.webhookId ? "Webhook not set up" : null,
  });

  // Kit and GoHighLevel
  for (const id of ["kit", "ghl"] as const) {
    const v = input.views.find((x) => x.provider === id);
    push({
      id,
      connected: Boolean(v?.connected),
      account: id === "ghl" && v?.locationId ? `Location …${v.locationId.slice(-4)}` : null,
      last4: id === "kit" ? tail(kitRow?.apiKey) : tail(cred("ghl"), true),
      error: v?.lastError ?? null,
      attention: v?.connected ? (!v.enabled ? "Sync is paused." : v.failing ? `${v.failing} contact${v.failing === 1 ? "" : "s"} failing to sync.` : null) : null,
      lastCheckedAt: v?.lastTestedAt ? new Date(v.lastTestedAt) : null,
      lastUsedAt: v?.lastSyncedAt ? new Date(v.lastSyncedAt) : null,
    });
  }

  // Calendars
  for (const id of ["calcom", "calendly"] as const) {
    const c = input.calendars.calendars.find((x) => x.provider === id);
    push({
      id,
      connected: Boolean(c?.connected),
      account: c?.settings.accountName ?? null,
      last4: tail(cred(id), true),
      error: c?.lastError ?? null,
      attention: c?.connected
        ? !c.enabled
          ? "Not booking: J sends your booking link instead."
          : !c.webhook.ready
            ? "Cancels, reschedules and no-shows don't come back yet: set up the webhook."
            : null
        : null,
      lastCheckedAt: c?.lastTestedAt ? new Date(c.lastTestedAt) : null,
      lastUsedAt: bookedAt(id),
    });
  }

  // Data OS
  const d = input.dataos;
  let host: string | null = null;
  try {
    host = d.baseUrl ? new URL(d.baseUrl).host : null;
  } catch {
    host = null;
  }
  push({
    id: "dataos",
    connected: d.connected,
    account: d.mode === "mock" ? "Sample data" : host,
    last4: tail(cred("dataos"), true),
    error: d.lastError,
    lastCheckedAt: d.lastTestedAt ? new Date(d.lastTestedAt) : null,
  });

  // Managed: set on the server. Connected when the key is there; the last
  // live check (OsConnection) turns it red.
  const present = managedPresence();
  for (const id of ["anthropic", "openrouter", "openai", "email", "redis"] as const) {
    push({ id, connected: present[id] });
  }

  return states;
}
