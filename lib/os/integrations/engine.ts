// The one-way sync (spec item 21): an event on a contact pushes its current
// state to every connected provider. The job always reads the contact fresh,
// so events can be coalesced, retried or replayed safely; an unchanged
// payload (same hash as the last success) is not sent again.
import { payloadHash } from "./hash";
import { buildPayload, inScope, type ContactSnapshot, type SyncEvent, type SyncProviderId } from "./mapping";
import { friendlyError } from "./provider";
import * as db from "./store";
import { kitNamesFor, kitTagNames, type KitTagLike } from "@/lib/os/tags/kit";

export type SyncOutcome =
  | { status: "synced"; externalId: string | null }
  | { status: "unchanged" }
  | { status: "skipped"; reason: string };

export interface SyncDeps {
  contactSnapshot(contactId: string, workspaceId: string): Promise<ContactSnapshot | null>;
  loadProvider(workspaceId: string, provider: SyncProviderId): Promise<db.ProviderConfig | null>;
  getSyncLog(contactId: string, provider: SyncProviderId): Promise<db.SyncLogRow | null>;
  /** What we pushed there before (fields, email) and removals waiting. */
  getSyncState(contactId: string, provider: SyncProviderId): Promise<db.SyncStateRow | null>;
  recordSuccess: typeof db.recordSuccess;
  recordFailure: typeof db.recordFailure;
  /** The workspace's managed tags with their Kit names (lib/os/tags/kit.ts).
   *  Absent = tags go as they are (the pre-managed-tags behaviour). */
  managedTags?(workspaceId: string): Promise<KitTagLike[]>;
}

const dbDeps: SyncDeps = {
  ...db,
  async managedTags(workspaceId) {
    const { listTags } = await import("@/lib/os/tags/store");
    return listTags(workspaceId);
  },
};

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

  const [log, state] = await Promise.all([deps.getSyncLog(contactId, provider), deps.getSyncState(contactId, provider)]);
  const prefix = config.mapping.tags ? config.mapping.tagPrefix : null;
  // Kit sees each managed tag under its Kit name(s), so a rename or merge here
  // is never a removal there (dm-crm issue 006).
  const managed = provider === "kit" && deps.managedTags ? await deps.managedTags(workspaceId).catch(() => null) : null;
  const unprefix = (t: string) => (prefix && t.startsWith(prefix) ? t.slice(prefix.length) : t);
  const snapshot = managed ? { ...contact, tags: kitTagNames(contact.tags, managed, (log?.pushedTags ?? []).map(unprefix)) } : contact;
  const payload = buildPayload(snapshot, config.mapping, provider);
  const wanted = managed ? (state?.removeTags ?? []).flatMap((t) => kitNamesFor(t, managed)) : (state?.removeTags ?? []);
  const removals = prefix == null ? [] : [...new Set(wanted)].map((t) => `${prefix}${t}`).filter((t) => !payload.tags.includes(t));
  if (removals.length) payload.removeTags = removals;
  const prev = { externalId: log?.externalId ?? null, pushedTags: log?.pushedTags ?? [], pushedFields: state?.pushedFields ?? {}, pushedEmail: state?.pushedEmail ?? null };
  // Kit waits for an email (then everything collected so far goes at once);
  // GoHighLevel for an email, a phone or an Instagram handle.
  const waits = config.client.waitsFor ? config.client.waitsFor(payload, prev) : config.client.requiresEmail && !payload.email ? "waits for an email" : null;
  if (waits) return { status: "skipped", reason: waits };

  const hash = payloadHash(provider, payload);
  if (log?.lastHash === hash && !log.lastError) return { status: "unchanged" };

  const key = { workspaceId, contactId, provider };
  try {
    const pushed = await config.client.push(payload, prev);
    await deps.recordSuccess(key, { ...pushed, hash, event, removedTags: state?.removeTags ?? [] });
    return { status: "synced", externalId: pushed.externalId };
  } catch (error) {
    await deps.recordFailure(key, friendlyError(error), event).catch(() => {});
    throw error;
  }
}
