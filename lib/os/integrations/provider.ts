// The shape every CRM / email list implements for the one-way sync.
import type { SyncPayload, SyncProviderId } from "./mapping";

export interface ProviderField {
  /** What goes in the mapping (Kit field key, GHL field id). */
  ref: string;
  label: string;
}

export interface ProviderPipeline {
  id: string;
  name: string;
  stages: { id: string; name: string }[];
}

export interface ProviderFields {
  customFields: ProviderField[];
  pipelines: ProviderPipeline[];
}

/** What we pushed last time for this person on this provider. */
export interface PushedState {
  externalId: string | null;
  pushedTags: string[];
}

export interface SyncProvider {
  id: SyncProviderId;
  /** Kit identifies subscribers by email, so nothing goes before we have one. */
  requiresEmail: boolean;
  verify(): Promise<void>;
  listFields(): Promise<ProviderFields>;
  push(payload: SyncPayload, prev: PushedState): Promise<PushedState>;
}

/** A provider HTTP failure. The message never carries the response body
 *  (bodies can echo personal data); only the status and a safe hint. */
export class SyncApiError extends Error {
  constructor(
    public provider: SyncProviderId,
    public status: number,
    message?: string
  ) {
    super(message ?? `${provider === "kit" ? "Kit" : "GoHighLevel"} request failed (HTTP ${status})`);
    this.name = "SyncApiError";
  }
}

/** Plain-language message for the screen. */
export function friendlyError(error: unknown): string {
  if (error instanceof SyncApiError) {
    const name = error.provider === "kit" ? "Kit" : "GoHighLevel";
    if (error.status === 401) return `${name} rejected the key. Reconnect with a fresh one.`;
    if (error.status === 403) return `The ${name} key is missing a permission (scope) this needs.`;
    if (error.status === 404) return `${name} couldn't find that ${error.provider === "ghl" ? "location or field" : "field or tag"}.`;
    if (error.status === 422 || error.status === 400) return `${name} refused a value. Check the field mapping.`;
    if (error.status === 429) return `${name} is rate limiting. It retries on its own.`;
    if (error.status === 502) return `${name} didn't respond. It retries on its own.`;
    return error.message;
  }
  return error instanceof Error ? error.message.slice(0, 200) : "Sync failed";
}

/** Tags to add and remove, given what we pushed last time. A first push (no
 *  external id yet) adds every tag. */
export function tagDiff(next: string[], prev: PushedState) {
  const before = new Set(prev.externalId ? prev.pushedTags : []);
  const after = new Set(next);
  return {
    add: next.filter((t) => !before.has(t)),
    remove: (prev.externalId ? prev.pushedTags : []).filter((t) => !after.has(t)),
  };
}
