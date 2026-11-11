// "Check now": one cheap live read per service (an account lookup, a list of
// one), never a send, a booking or a write at the provider. The result is in
// words and an account name; no key or token leaves this file.
import { prisma } from "@/lib/db/client";
import { getUserInfo } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { dataOsFor } from "@/lib/os/dataos/store";
import { loadCalendarProvider } from "@/lib/os/integrations/calendar/store";
import { friendlyError } from "@/lib/os/integrations/provider";
import { loadProvider } from "@/lib/os/integrations/store";
import { osMockEnabled } from "@/lib/os/mock";
import { getRedisConnection } from "@/lib/queue/client";
import { listInstagramAccounts, listProfiles, listWebhooks } from "@/lib/zernio/manage-remote";
import { cleanNote, type ServiceId } from "./catalog";

export interface CheckResult {
  ok: boolean;
  /** Not set up at all: nothing to check (the card stays "Not connected"). */
  absent?: boolean;
  error?: string | null;
  account?: string | null;
}

const TIMEOUT = 8_000;
type Env = Record<string, string | undefined>;

function fail(err: unknown): CheckResult {
  return { ok: false, error: cleanNote(friendlyError(err)) ?? "The check failed." };
}

async function httpOk(url: string, headers: Record<string, string>, fetchFn: typeof fetch): Promise<Response> {
  return fetchFn(url, { headers, signal: AbortSignal.timeout(TIMEOUT), cache: "no-store" });
}

function statusError(name: string, res: Response): string {
  if (res.status === 401 || res.status === 403) return `${name} refused the key (${res.status}).`;
  return `${name} answered ${res.status}.`;
}

/** Which managed keys are set, by name only (the values never leave the env). */
export function managedPresence(env: Env = process.env): Record<"anthropic" | "openrouter" | "openai" | "email" | "redis", boolean> {
  const has = (k: string) => Boolean(env[k]?.trim());
  return {
    anthropic: has("ANTHROPIC_API_KEY") || has("ANTHROPIC_AUTH_TOKEN"),
    openrouter: has("OPENROUTER_API_KEY"),
    openai: has("OPENAI_API_KEY"),
    email: has("RESEND_API_KEY") || has("EMAIL_SERVER"),
    redis: has("REDIS_URL"),
  };
}

/** The managed (server-env) services: a read-only call with the server's key. */
export async function checkManaged(id: ServiceId, env: Env = process.env, fetchFn: typeof fetch = fetch): Promise<CheckResult> {
  try {
    switch (id) {
      case "anthropic": {
        const key = env.ANTHROPIC_API_KEY?.trim();
        const bearer = env.ANTHROPIC_AUTH_TOKEN?.trim();
        if (!key && !bearer) return { ok: false, absent: true };
        const res = await httpOk(
          "https://api.anthropic.com/v1/models?limit=1",
          { "anthropic-version": "2023-06-01", ...(key ? { "x-api-key": key } : { Authorization: `Bearer ${bearer}` }) },
          fetchFn
        );
        return res.ok ? { ok: true } : { ok: false, error: statusError("Anthropic", res) };
      }
      case "openrouter": {
        const key = env.OPENROUTER_API_KEY?.trim();
        if (!key) return { ok: false, absent: true };
        const res = await httpOk("https://openrouter.ai/api/v1/key", { Authorization: `Bearer ${key}` }, fetchFn);
        return res.ok ? { ok: true } : { ok: false, error: statusError("OpenRouter", res) };
      }
      case "openai": {
        const key = env.OPENAI_API_KEY?.trim();
        if (!key) return { ok: false, absent: true };
        const res = await httpOk("https://api.openai.com/v1/models", { Authorization: `Bearer ${key}` }, fetchFn);
        return res.ok ? { ok: true } : { ok: false, error: statusError("OpenAI", res) };
      }
      case "email": {
        const key = env.RESEND_API_KEY?.trim();
        if (env.EMAIL_SERVER?.trim()) return { ok: true, account: "Your SMTP server" };
        if (!key) return { ok: false, absent: true };
        const res = await httpOk("https://api.resend.com/domains", { Authorization: `Bearer ${key}` }, fetchFn);
        if (res.ok) return { ok: true, account: "Resend" };
        // A sending-only key can't list domains: Resend says so with
        // restricted_api_key, which still proves the key is valid.
        const body = (await res.json().catch(() => null)) as { name?: string } | null;
        if (res.status === 401 && body?.name === "restricted_api_key") return { ok: true, account: "Resend (sending-only key)" };
        return { ok: false, error: statusError("Resend", res) };
      }
      case "redis": {
        if (!env.REDIS_URL?.trim()) return { ok: false, absent: true };
        const pong = await Promise.race([
          getRedisConnection().ping(),
          new Promise<string>((_, reject) => setTimeout(() => reject(new Error("Redis didn't answer in time.")), TIMEOUT)),
        ]);
        return pong === "PONG" ? { ok: true } : { ok: false, error: "Redis didn't answer PONG." };
      }
      default:
        return { ok: false, absent: true };
    }
  } catch (err) {
    return fail(err);
  }
}

/** One service, live. Read-only at the provider. */
export async function checkService(workspaceId: string, id: ServiceId): Promise<CheckResult> {
  try {
    switch (id) {
      case "instagram": {
        if (osMockEnabled()) return { ok: true, account: "@claudepreneur (sample)" };
        const row = await prisma.instagramAccount.findFirst({
          where: { workspaceId },
          orderBy: { connectedAt: "desc" },
          select: { provider: true, accessToken: true, username: true, zernioAccountId: true, tokenExpiresAt: true },
        });
        if (!row) return { ok: false, absent: true };
        if (row.provider === "ZERNIO") {
          const z = await prisma.zernioConnection.findUnique({ where: { workspaceId } });
          if (!z || !z.profileId) return { ok: false, error: "Zernio isn't set up for this account." };
          const accounts = await listInstagramAccounts({ apiKey: decryptToken(z.apiKey), profileId: z.profileId });
          const found = accounts.find((a) => a.id === row.zernioAccountId);
          return found ? { ok: true, account: `@${found.username} (through Zernio)` } : { ok: false, error: "Zernio no longer lists this Instagram account." };
        }
        if (row.tokenExpiresAt && row.tokenExpiresAt.getTime() < Date.now()) return { ok: false, error: "The Instagram token expired. Reconnect." };
        const me = await getUserInfo(decryptToken(row.accessToken));
        return { ok: true, account: `@${me.username}` };
      }
      case "zernio": {
        const z = await prisma.zernioConnection.findUnique({ where: { workspaceId } });
        if (!z) return { ok: false, absent: true };
        const apiKey = decryptToken(z.apiKey);
        const [profiles, hooks] = await Promise.all([listProfiles(apiKey), listWebhooks(apiKey)]);
        const profile = profiles.find((p) => p.id === z.profileId);
        if (!z.profileId) return { ok: true, account: "No profile picked yet" };
        if (!profile) return { ok: false, error: "The picked Zernio profile is gone. Pick one again." };
        if (z.webhookId && !hooks.some((h) => h._id === z.webhookId)) return { ok: false, error: "Our webhook is missing at Zernio. Pick the profile again to restore it." };
        return { ok: true, account: profile.name };
      }
      case "kit":
      case "ghl": {
        const config = await loadProvider(workspaceId, id);
        if (!config) return { ok: false, absent: true };
        await config.client.verify();
        return { ok: true };
      }
      case "calcom":
      case "calendly": {
        const loaded = await loadCalendarProvider(workspaceId, id);
        if (!loaded) return { ok: false, absent: true };
        const account = await loaded.client.verify();
        return { ok: true, account: account.name ?? account.email ?? null };
      }
      case "dataos": {
        const client = await dataOsFor(workspaceId);
        if (!client) return { ok: false, absent: true };
        const st = await client.status();
        return st.connected ? { ok: true } : { ok: false, error: cleanNote(st.error) ?? "Data OS didn't answer." };
      }
      default:
        return checkManaged(id);
    }
  } catch (err) {
    return fail(err);
  }
}
