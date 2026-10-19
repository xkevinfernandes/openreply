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
  /** Field ref -> the value we pushed ("$first_name" for the first name). A
   *  merge only overwrites a value there when it's empty or ours. */
  pushedFields?: Record<string, string>;
  /** The email we last pushed: a different one now is a correction. */
  pushedEmail?: string | null;
}

export interface SyncProvider {
  id: SyncProviderId;
  /** Kit identifies subscribers by email, so nothing goes before we have one. */
  requiresEmail: boolean;
  /** Why this payload can't be pushed yet (e.g. no way to identify them), or null. */
  waitsFor?(payload: SyncPayload, prev: PushedState): string | null;
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

/**
 * Tags to add and remove. Tags are add-only: a tag that's simply gone from
 * the contact stays in the CRM. Only a removal made on purpose (removeTag)
 * is removed there. A first push (no external id yet) adds every tag.
 */
export function tagDiff(next: string[], prev: PushedState, removals: string[] = []) {
  const before = new Set(prev.externalId ? prev.pushedTags : []);
  const remove = [...new Set(removals)].filter((t) => !next.includes(t));
  return { add: next.filter((t) => !before.has(t)), remove };
}

/** Tags as pushed after this push: what was there, plus added, minus removed. */
export function tagsAfter(next: string[], prev: PushedState, removed: string[]): string[] {
  const out = new Set([...(prev.externalId ? prev.pushedTags : []), ...next]);
  for (const t of removed) out.delete(t);
  return [...out].sort();
}

const blank = (v: unknown) => v == null || String(v).trim() === "";

/**
 * Merge into a record the CRM already has: a value is sent only when theirs
 * is empty or is the one we pushed before. Never overwrites their own data.
 * Returns what to send and the new "pushed" memory.
 */
export function fillOnly(
  ours: Record<string, string | null | undefined>,
  theirs: Record<string, unknown>,
  pushed: Record<string, string>
): { send: Record<string, string>; pushed: Record<string, string> } {
  const send: Record<string, string> = {};
  const next = { ...pushed };
  for (const [k, v] of Object.entries(ours)) {
    if (blank(v)) continue;
    const t = theirs[k];
    if (!blank(t) && String(t) !== pushed[k]) {
      if (String(t) === v) next[k] = v as string;
      continue;
    }
    if (String(t ?? "") !== v) send[k] = v as string;
    next[k] = v as string;
  }
  return { send, pushed: next };
}
