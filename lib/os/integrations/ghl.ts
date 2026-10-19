// GoHighLevel (LeadConnector API v2) for the one-way sync. Auth is a Private
// Integration token for one sub-account (location).
// https://highlevel.stoplight.io/docs/integrations
//
// Scopes the token needs: contacts.write, contacts.readonly,
// locations/customFields.readonly, and for the optional pipeline:
// opportunities.readonly, opportunities.write.
import type { SyncPayload } from "./mapping";
import { fillOnly, SyncApiError, tagDiff, tagsAfter, type ProviderFields, type PushedState, type SyncProvider } from "./provider";

export const GHL_BASE = "https://services.leadconnectorhq.com";
export const GHL_VERSION = "2021-07-28";

export interface GhlCredentials {
  token: string;
  locationId: string;
}

async function ghl<T>(creds: GhlCredentials, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${GHL_BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${creds.token}`,
      Version: GHL_VERSION,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  }).catch(() => {
    throw new SyncApiError("ghl", 502);
  });
  if (!response.ok) throw new SyncApiError("ghl", response.status);
  if (response.status === 204) return undefined as T;
  return (await response.json().catch(() => ({}))) as T;
}

/** A field reference is a custom field id, or a "contact.some_key" key. */
export function ghlCustomFields(custom: Record<string, string>) {
  return Object.entries(custom).map(([ref, value]) => (ref.startsWith("contact.") ? { key: ref, field_value: value } : { id: ref, field_value: value }));
}

export function ghlContactBody(p: SyncPayload) {
  const fields = ghlCustomFields(p.custom);
  return {
    ...(p.email ? { email: p.email } : {}),
    ...(p.phone ? { phone: p.phone } : {}),
    ...(p.firstName ? { firstName: p.firstName } : {}),
    ...(fields.length ? { customFields: fields } : {}),
  };
}

const OPPORTUNITY_STATUS: Partial<Record<SyncPayload["stage"], string>> = { WON: "won", LOST: "lost" };

type GhlContact = { id: string; email?: string | null; phone?: string | null; firstName?: string | null; customFields?: { id: string; value?: unknown }[] };

const FIRST = "$first_name";
const EMAIL = "$email";
const PHONE = "$phone";
/** Never blank, never equal to a value: fillOnly leaves the field alone. */
const UNRESOLVED = { unresolved: true };
const gone = (e: unknown) => e instanceof SyncApiError && (e.status === 404 || e.status === 400);

export function createGhlSync(creds: GhlCredentials): SyncProvider {
  const loc = encodeURIComponent(creds.locationId);
  const byId = (id: string) =>
    ghl<{ contact?: GhlContact }>(creds, `/contacts/${encodeURIComponent(id)}`).then(
      (r) => r.contact ?? null,
      (e) => {
        if (gone(e)) return null;
        throw e;
      }
    );
  const duplicate = async (p: { email?: string | null; phone?: string | null }) => {
    const q = p.email ? `email=${encodeURIComponent(p.email)}` : p.phone ? `number=${encodeURIComponent(p.phone)}` : null;
    if (!q) return null;
    const r = await ghl<{ contact?: GhlContact | null }>(creds, `/contacts/search/duplicate?locationId=${loc}&${q}`);
    return r.contact?.id ? r.contact : null;
  };
  /** "contact.key" refs -> field ids, to read their current values. */
  let keyIds: Map<string, string> | null = null;
  const idFor = async (ref: string) => {
    if (!ref.startsWith("contact.")) return ref;
    if (!keyIds) {
      const r = await ghl<{ customFields?: { id: string; fieldKey?: string }[] }>(creds, `/locations/${loc}/customFields`);
      keyIds = new Map((r.customFields ?? []).filter((f) => f.fieldKey).map((f) => [f.fieldKey as string, f.id]));
    }
    return keyIds.get(ref) ?? null;
  };

  return {
    id: "ghl",
    requiresEmail: false,
    // Q-F1: an Instagram handle + name is enough to create them, so the
    // pipeline shows every lead. Without any of those, wait.
    waitsFor: (p, prev) => (prev.externalId || p.email || p.phone || p.handle ? null : "waits for contact info"),
    async verify() {
      // Reads the location's custom fields: proves the token, the location id
      // and the scope the mapping screen needs, in one call.
      await ghl(creds, `/locations/${loc}/customFields`);
    },
    async listFields(): Promise<ProviderFields> {
      const fields: { customFields?: { id: string; name: string; fieldKey?: string; model?: string }[] } = await ghl(
        creds,
        `/locations/${loc}/customFields`
      );
      type Pipelines = { pipelines?: { id: string; name: string; stages?: { id: string; name: string }[] }[] };
      // No opportunities scope is fine: the pipeline is optional.
      const pipelines = await ghl<Pipelines>(creds, `/opportunities/pipelines?locationId=${loc}`).catch((): Pipelines => ({ pipelines: [] }));
      return {
        customFields: (fields.customFields ?? [])
          .filter((f) => !f.model || f.model === "contact")
          .map((f) => ({ ref: f.id, label: f.name })),
        pipelines: (pipelines.pipelines ?? []).map((pl) => ({ id: pl.id, name: pl.name, stages: (pl.stages ?? []).map((s) => ({ id: s.id, name: s.name })) })),
      };
    },
    /**
     * Find them (the id we know, else a duplicate by email / phone), merge
     * into what GoHighLevel has (fill empty fields only), or create them:
     * on email or phone, or on handle + name (POST /contacts, never upsert,
     * since upsert dedupes on email/phone and has nothing to match on).
     * A corrected email updates the same contact unless the new one is
     * already someone else there: then that contact is used instead.
     */
    async push(p: SyncPayload, prev: PushedState): Promise<PushedState> {
      let pushed = prev.pushedFields ?? {};
      let base: PushedState = prev;
      let contact = prev.externalId ? await byId(prev.externalId) : null;
      const adopt = (c: GhlContact) => {
        contact = c;
        pushed = {};
        base = { externalId: null, pushedTags: [] };
      };

      if (contact && p.email && (contact.email ?? "").toLowerCase() !== p.email) {
        const other = await duplicate({ email: p.email });
        if (other && other.id !== contact.id) adopt(other);
      }
      if (!contact) {
        const found = await duplicate(p);
        if (found) adopt(found);
      }

      let id: string;
      if (!contact) {
        const res: { contact?: { id?: string } } = await ghl(creds, "/contacts/", {
          method: "POST",
          body: { locationId: creds.locationId, source: "Instagram DM", ...(p.name ? { name: p.name } : {}), ...ghlContactBody(p) },
        });
        if (!res.contact?.id) throw new SyncApiError("ghl", 500, "GoHighLevel didn't return a contact id");
        id = res.contact.id;
        pushed = {
          ...p.custom,
          ...(p.firstName ? { [FIRST]: p.firstName } : {}),
          ...(p.email ? { [EMAIL]: p.email } : {}),
          ...(p.phone ? { [PHONE]: p.phone } : {}),
        };
        base = { externalId: null, pushedTags: [] };
      } else {
        const current: GhlContact = contact;
        id = current.id;
        const theirs: Record<string, unknown> = { [FIRST]: current.firstName, [EMAIL]: current.email?.toLowerCase(), [PHONE]: current.phone };
        for (const ref of Object.keys(p.custom)) {
          const fid = await idFor(ref);
          // A key we can't resolve: treat theirs as unknown and leave it.
          theirs[ref] = fid ? (current.customFields ?? []).find((f) => f.id === fid)?.value : UNRESOLVED;
        }
        const merge = fillOnly({ ...p.custom, [FIRST]: p.firstName, [EMAIL]: p.email, [PHONE]: p.phone }, theirs, pushed);
        pushed = merge.pushed;
        const { [FIRST]: first, [EMAIL]: email, [PHONE]: phone, ...custom } = merge.send;
        const fields = ghlCustomFields(custom);
        const body = { ...(email ? { email } : {}), ...(phone ? { phone } : {}), ...(first ? { firstName: first } : {}), ...(fields.length ? { customFields: fields } : {}) };
        if (Object.keys(body).length) await ghl(creds, `/contacts/${encodeURIComponent(id)}`, { method: "PUT", body });
      }

      const known: PushedState = base.externalId === id ? base : { externalId: null, pushedTags: [] };
      const { add, remove } = tagDiff(p.tags, known, p.removeTags);
      const enc = encodeURIComponent(id);
      // Tags go through their own endpoints: the contact body would replace
      // every tag, including ones added in GHL.
      if (add.length) await ghl(creds, `/contacts/${enc}/tags`, { method: "POST", body: { tags: add } });
      if (remove.length) await ghl(creds, `/contacts/${enc}/tags`, { method: "DELETE", body: { tags: remove } });
      if (p.pipeline?.pipelineId && p.pipeline.stageId) {
        await ghl(creds, "/opportunities/upsert", {
          method: "POST",
          body: {
            locationId: creds.locationId,
            pipelineId: p.pipeline.pipelineId,
            pipelineStageId: p.pipeline.stageId,
            contactId: id,
            name: p.name,
            status: OPPORTUNITY_STATUS[p.stage] ?? "open",
          },
        });
      }
      return { externalId: id, pushedTags: tagsAfter(p.tags, known, remove), pushedFields: pushed, pushedEmail: p.email ?? prev.pushedEmail ?? null };
    },
  };
}
