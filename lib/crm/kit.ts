// Kit (ConvertKit) v4. Auth is the `X-Kit-Api-Key` header.
// https://developers.kit.com/api-reference
import type { CrmLead, CrmProviderClient, CrmTag } from "./types";

const BASE = "https://api.kit.com/v4";

export class KitApiError extends Error {
  constructor(public status: number, message?: string) {
    // Kit error bodies can echo request data; only the status is kept.
    super(message ?? `Kit request failed (HTTP ${status})`);
    this.name = "KitApiError";
  }
}

async function kitRequest<T>(apiKey: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: { "X-Kit-Api-Key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  }).catch(() => {
    throw new KitApiError(502);
  });
  if (!response.ok) throw new KitApiError(response.status);
  if (response.status === 204) return undefined as T;
  return (await response.json().catch(() => ({}))) as T;
}

export function kitSubscriberBody(lead: CrmLead) {
  return {
    email_address: lead.email,
    ...(lead.firstName ? { first_name: lead.firstName } : {}),
    ...(lead.fields && Object.keys(lead.fields).length ? { fields: lead.fields } : {}),
  };
}

export function createKitClient(apiKey: string): CrmProviderClient {
  return {
    async verify() {
      await kitRequest(apiKey, "/account");
    },
    async listTags(): Promise<CrmTag[]> {
      const tags: CrmTag[] = [];
      let after: string | null = null;
      // Kit paginates with cursors; 10 pages of 1000 is far beyond any real account.
      for (let page = 0; page < 10; page++) {
        const query: string = `?per_page=1000${after ? `&after=${encodeURIComponent(after)}` : ""}`;
        const data: { tags?: { id: number; name: string }[]; pagination?: { has_next_page?: boolean; end_cursor?: string } } =
          await kitRequest(apiKey, `/tags${query}`);
        for (const tag of data.tags ?? []) tags.push({ id: String(tag.id), name: tag.name });
        if (!data.pagination?.has_next_page || !data.pagination.end_cursor) break;
        after = data.pagination.end_cursor;
      }
      return tags;
    },
    async upsertLead(lead: CrmLead) {
      // POST /subscribers upserts on email, so a returning lead is updated, not duplicated.
      await kitRequest(apiKey, "/subscribers", { method: "POST", body: kitSubscriberBody(lead) });
      for (const tagId of lead.tagIds ?? []) {
        await kitRequest(apiKey, `/tags/${encodeURIComponent(tagId)}/subscribers`, {
          method: "POST",
          body: { email_address: lead.email },
        });
      }
    },
  };
}
