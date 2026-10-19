// Kit (ConvertKit) v4 for the one-way sync. Credentials stay in the upstream
// CrmConnection (lib/crm), the email gate uses the same key.
// https://developers.kit.com/api-reference
import type { SyncPayload } from "./mapping";
import { fillOnly, SyncApiError, tagDiff, tagsAfter, type ProviderFields, type PushedState, type SyncProvider } from "./provider";

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

type KitSubscriber = { id: number | string; email_address?: string; first_name?: string | null; fields?: Record<string, unknown> };

const FIRST = "$first_name";
const notFound = (e: unknown) => e instanceof SyncApiError && e.status === 404;

export function createKitSync(apiKey: string): SyncProvider {
  const byId = (id: string) =>
    kit<{ subscriber?: KitSubscriber }>(apiKey, `/subscribers/${encodeURIComponent(id)}`).then(
      (r) => r.subscriber ?? null,
      (e) => {
        if (notFound(e)) return null;
        throw e;
      }
    );
  // status=all: a subscriber who unsubscribed is still the same person.
  const byEmail = (email: string) =>
    kit<{ subscribers?: KitSubscriber[] }>(apiKey, `/subscribers?status=all&email_address=${encodeURIComponent(email)}`).then((r) => r.subscribers?.[0] ?? null);

  return {
    id: "kit",
    requiresEmail: true,
    waitsFor: (p) => (p.email ? null : "waits for an email"),
    async verify() {
      await kit(apiKey, "/account");
    },
    async listFields(): Promise<ProviderFields> {
      const data: { custom_fields?: { id: number; key: string; label: string }[] } = await kit(apiKey, "/custom_fields?per_page=1000");
      return { customFields: (data.custom_fields ?? []).map((f) => ({ ref: f.key, label: f.label || f.key })), pipelines: [] };
    },
    /**
     * One subscriber per person: found by the id we know, else by email.
     * A corrected email moves that subscriber to the new address (unless the
     * new address is already someone in Kit: then that one is merged into).
     * An existing subscriber only gets their empty fields filled. Never
     * changes their subscription (no unsubscribe, no resubscribe).
     */
    async push(p: SyncPayload, prev: PushedState): Promise<PushedState> {
      if (!p.email) throw new Error("Kit needs an email first.");
      const email = p.email;
      let pushed = prev.pushedFields ?? {};
      let base: PushedState = prev;
      let sub = prev.externalId ? await byId(prev.externalId) : null;
      const adopt = (s: KitSubscriber) => {
        sub = s;
        pushed = {};
        base = { externalId: null, pushedTags: [] };
      };

      if (sub && (sub.email_address ?? "").toLowerCase() !== email) {
        const other = await byEmail(email);
        if (other && String(other.id) !== String(sub.id)) adopt(other);
        else {
          try {
            const r = await kit<{ subscriber?: KitSubscriber }>(apiKey, `/subscribers/${encodeURIComponent(String(sub.id))}`, { method: "PUT", body: { email_address: email } });
            sub = { ...sub, ...(r?.subscriber ?? {}), email_address: email };
          } catch (e) {
            // Taken in the meantime: merge into whoever has it now.
            if (!(e instanceof SyncApiError && e.status === 422)) throw e;
            const taken = await byEmail(email);
            if (!taken) throw e;
            adopt(taken);
          }
        }
      }
      if (!sub) {
        const found = await byEmail(email);
        if (found) adopt(found);
      }

      let id: string;
      if (!sub) {
        const res: { subscriber?: { id?: number } } = await kit(apiKey, "/subscribers", { method: "POST", body: kitSyncBody(p) });
        if (res.subscriber?.id == null) throw new SyncApiError("kit", 500, "Kit didn't return a subscriber id");
        id = String(res.subscriber.id);
        pushed = { ...p.custom, ...(p.firstName ? { [FIRST]: p.firstName } : {}) };
        base = { externalId: null, pushedTags: [] };
      } else {
        const current: KitSubscriber = sub;
        id = String(current.id);
        const merge = fillOnly({ ...p.custom, [FIRST]: p.firstName }, { ...(current.fields ?? {}), [FIRST]: current.first_name }, pushed);
        pushed = merge.pushed;
        const { [FIRST]: first, ...fields } = merge.send;
        if (first || Object.keys(fields).length) {
          await kit(apiKey, `/subscribers/${encodeURIComponent(id)}`, {
            method: "PUT",
            body: { ...(first ? { first_name: first } : {}), ...(Object.keys(fields).length ? { fields } : {}) },
          });
        }
      }

      // Tags we know they have: only on the same subscriber as last time.
      const known: PushedState = base.externalId === id ? base : { externalId: null, pushedTags: [] };
      const { add, remove } = tagDiff(p.tags, known, p.removeTags);
      if (add.length || remove.length) {
        const byName = new Map((await allTags(apiKey)).map((t) => [t.name.toLowerCase(), String(t.id)]));
        for (const name of add) {
          let tagId = byName.get(name.toLowerCase());
          if (!tagId) {
            const created: { tag?: KitTag } = await kit(apiKey, "/tags", { method: "POST", body: { name } });
            if (created.tag?.id == null) throw new SyncApiError("kit", 500, "Kit didn't create the tag");
            tagId = String(created.tag.id);
            byName.set(name.toLowerCase(), tagId);
          }
          await kit(apiKey, `/tags/${encodeURIComponent(tagId)}/subscribers/${encodeURIComponent(id)}`, { method: "POST", body: {} });
        }
        for (const name of remove) {
          const tagId = byName.get(name.toLowerCase());
          if (!tagId) continue;
          await kit(apiKey, `/tags/${encodeURIComponent(tagId)}/subscribers/${encodeURIComponent(id)}`, { method: "DELETE" }).catch((e) => {
            // Already untagged (or removed in Kit) is fine.
            if (!notFound(e)) throw e;
          });
        }
      }
      return { externalId: id, pushedTags: tagsAfter(p.tags, known, remove), pushedFields: pushed, pushedEmail: email };
    },
  };
}
