// Kit (ConvertKit) v4 for the one-way sync. Credentials stay in the upstream
// CrmConnection (lib/crm), the email gate uses the same key.
// https://developers.kit.com/api-reference
import type { SyncPayload } from "./mapping";
import { SyncApiError, tagDiff, type ProviderFields, type PushedState, type SyncProvider } from "./provider";

const BASE = "https://api.kit.com/v4";

async function kit<T>(apiKey: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: { "X-Kit-Api-Key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  }).catch(() => {
    throw new SyncApiError("kit", 502);
  });
  if (!response.ok) throw new SyncApiError("kit", response.status);
  if (response.status === 204) return undefined as T;
  return (await response.json().catch(() => ({}))) as T;
}

type KitTag = { id: number; name: string };

async function allTags(apiKey: string): Promise<KitTag[]> {
  const tags: KitTag[] = [];
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const query: string = `?per_page=1000${after ? `&after=${encodeURIComponent(after)}` : ""}`;
    const data: { tags?: KitTag[]; pagination?: { has_next_page?: boolean; end_cursor?: string } } = await kit(apiKey, `/tags${query}`);
    tags.push(...(data.tags ?? []));
    if (!data.pagination?.has_next_page || !data.pagination.end_cursor) break;
    after = data.pagination.end_cursor;
  }
  return tags;
}

/** The subscriber body: email is the identity, custom fields go by key. */
export function kitSyncBody(p: SyncPayload) {
  return {
    email_address: p.email,
    ...(p.firstName ? { first_name: p.firstName } : {}),
    ...(Object.keys(p.custom).length ? { fields: p.custom } : {}),
  };
}

export function createKitSync(apiKey: string): SyncProvider {
  return {
    id: "kit",
    requiresEmail: true,
    async verify() {
      await kit(apiKey, "/account");
    },
    async listFields(): Promise<ProviderFields> {
      const data: { custom_fields?: { id: number; key: string; label: string }[] } = await kit(apiKey, "/custom_fields?per_page=1000");
      return { customFields: (data.custom_fields ?? []).map((f) => ({ ref: f.key, label: f.label || f.key })), pipelines: [] };
    },
    async push(p: SyncPayload, prev: PushedState): Promise<PushedState> {
      if (!p.email) throw new Error("Kit needs an email first.");
      // POST /subscribers upserts on email.
      const res: { subscriber?: { id?: number } } = await kit(apiKey, "/subscribers", { method: "POST", body: kitSyncBody(p) });
      const subscriberId = res.subscriber?.id != null ? String(res.subscriber.id) : prev.externalId;
      const { add, remove } = tagDiff(p.tags, prev);
      if (add.length || remove.length) {
        const byName = new Map((await allTags(apiKey)).map((t) => [t.name.toLowerCase(), String(t.id)]));
        for (const name of add) {
          let id = byName.get(name.toLowerCase());
          if (!id) {
            const created: { tag?: KitTag } = await kit(apiKey, "/tags", { method: "POST", body: { name } });
            if (created.tag?.id == null) throw new SyncApiError("kit", 500, "Kit didn't create the tag");
            id = String(created.tag.id);
            byName.set(name.toLowerCase(), id);
          }
          await kit(apiKey, `/tags/${encodeURIComponent(id)}/subscribers`, { method: "POST", body: { email_address: p.email } });
        }
        for (const name of remove) {
          const id = byName.get(name.toLowerCase());
          if (!id || !subscriberId) continue;
          await kit(apiKey, `/tags/${encodeURIComponent(id)}/subscribers/${encodeURIComponent(subscriberId)}`, { method: "DELETE" }).catch(
            (e) => {
              // Already untagged (or removed in Kit) is fine.
              if (!(e instanceof SyncApiError && e.status === 404)) throw e;
            }
          );
        }
      }
      return { externalId: subscriberId ?? null, pushedTags: p.tags };
    },
  };
}
