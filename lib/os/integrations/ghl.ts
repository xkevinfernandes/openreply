// GoHighLevel (LeadConnector API v2) for the one-way sync. Auth is a Private
// Integration token for one sub-account (location).
// https://highlevel.stoplight.io/docs/integrations
//
// Scopes the token needs: contacts.write, contacts.readonly,
// locations/customFields.readonly, and for the optional pipeline:
// opportunities.readonly, opportunities.write.
import type { SyncPayload } from "./mapping";
import { SyncApiError, tagDiff, type ProviderFields, type PushedState, type SyncProvider } from "./provider";

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
    ...(p.firstName ? { firstName: p.firstName } : {}),
    ...(fields.length ? { customFields: fields } : {}),
  };
}

const OPPORTUNITY_STATUS: Partial<Record<SyncPayload["stage"], string>> = { WON: "won", LOST: "lost" };

export function createGhlSync(creds: GhlCredentials): SyncProvider {
  const loc = encodeURIComponent(creds.locationId);
  return {
    id: "ghl",
    requiresEmail: false,
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
    async push(p: SyncPayload, prev: PushedState): Promise<PushedState> {
      const body = ghlContactBody(p);
      let contactId = prev.externalId;
      let first = !contactId;
      if (contactId) {
        // We know them: update in place (works without an email too).
        try {
          await ghl(creds, `/contacts/${encodeURIComponent(contactId)}`, { method: "PUT", body });
        } catch (e) {
          if (!(e instanceof SyncApiError && (e.status === 404 || e.status === 400))) throw e;
          contactId = null; // deleted in GHL: create again below
          first = true;
        }
      }
      if (!contactId) {
        // Upsert dedupes on email (per the location's duplicate settings).
        const res: { contact?: { id?: string } } = await ghl(creds, "/contacts/upsert", {
          method: "POST",
          body: { locationId: creds.locationId, source: "Instagram DM", ...(p.name ? { name: p.name } : {}), ...body },
        });
        contactId = res.contact?.id ?? null;
        if (!contactId) throw new SyncApiError("ghl", 500, "GoHighLevel didn't return a contact id");
      }
      const { add, remove } = tagDiff(p.tags, first ? { externalId: null, pushedTags: [] } : prev);
      const id = encodeURIComponent(contactId);
      // Tags go through their own endpoints: the contact body would replace
      // every tag, including ones added in GHL.
      if (add.length) await ghl(creds, `/contacts/${id}/tags`, { method: "POST", body: { tags: add } });
      if (remove.length) await ghl(creds, `/contacts/${id}/tags`, { method: "DELETE", body: { tags: remove } });
      if (p.pipeline?.pipelineId && p.pipeline.stageId) {
        await ghl(creds, "/opportunities/upsert", {
          method: "POST",
          body: {
            locationId: creds.locationId,
            pipelineId: p.pipeline.pipelineId,
            pipelineStageId: p.pipeline.stageId,
            contactId,
            name: p.name,
            status: OPPORTUNITY_STATUS[p.stage] ?? "open",
          },
        });
      }
      return { externalId: contactId, pushedTags: p.tags };
    },
  };
}
