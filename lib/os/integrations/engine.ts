// The one-way sync (spec item 21): an event on a contact pushes its current
// state to every connected provider. The job always reads the contact fresh,
// so events can be coalesced, retried or replayed safely; an unchanged
// payload (same hash as the last success) is not sent again.
import { payloadHash } from "./hash";
import { buildPayload, inScope, type ContactSnapshot, type SyncEvent, type SyncProviderId } from "./mapping";
import { friendlyError } from "./provider";
import * as db from "./store";

export type SyncOutcome =
  | { status: "synced"; externalId: string | null }
  | { status: "unchanged" }
  | { status: "skipped"; reason: string };

export interface SyncDeps {
  contactSnapshot(contactId: string, workspaceId: string): Promise<ContactSnapshot | null>;
  loadProvider(workspaceId: string, provider: SyncProviderId): Promise<db.ProviderConfig | null>;
  getSyncLog(contactId: string, provider: SyncProviderId): Promise<db.SyncLogRow | null>;
  recordSuccess: typeof db.recordSuccess;
  recordFailure: typeof db.recordFailure;
}

const dbDeps: SyncDeps = db;

export interface SyncJobInput {
  workspaceId: string;
  contactId: string;
  provider: SyncProviderId;
  event: SyncEvent;
}

/** Push one contact to one provider. Throws on provider errors (after
 *  recording them) so the queue retries. */
export async function syncContact(input: SyncJobInput, deps: SyncDeps = dbDeps): Promise<SyncOutcome> {
  const { workspaceId, contactId, provider, event } = input;
  const config = await deps.loadProvider(workspaceId, provider);
  if (!config) return { status: "skipped", reason: "not connected" };
  if (!config.enabled) return { status: "skipped", reason: "paused" };
  const contact = await deps.contactSnapshot(contactId, workspaceId);
  if (!contact) return { status: "skipped", reason: "no such contact" };
  if (!inScope(contact, config.mapping)) return { status: "skipped", reason: "not a sales contact" };

  const payload = buildPayload(contact, config.mapping, provider);
  if (config.client.requiresEmail && !payload.email) return { status: "skipped", reason: "waits for an email" };

  const hash = payloadHash(provider, payload);
  const log = await deps.getSyncLog(contactId, provider);
  if (log?.lastHash === hash && !log.lastError) return { status: "unchanged" };

  const key = { workspaceId, contactId, provider };
  try {
    const pushed = await config.client.push(payload, { externalId: log?.externalId ?? null, pushedTags: log?.pushedTags ?? [] });
    await deps.recordSuccess(key, { ...pushed, hash, event });
    return { status: "synced", externalId: pushed.externalId };
  } catch (error) {
    await deps.recordFailure(key, friendlyError(error), event).catch(() => {});
    throw error;
  }
}
