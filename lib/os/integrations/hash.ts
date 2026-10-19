import { createHash } from "node:crypto";
import type { SyncPayload, SyncProviderId } from "./mapping";

/** Stable hash of what would be pushed: same hash = nothing to do. */
export function payloadHash(provider: SyncProviderId, p: SyncPayload): string {
  const custom = Object.keys(p.custom)
    .sort()
    .map((k) => [k, p.custom[k]]);
  return createHash("sha256")
    .update(JSON.stringify([provider, p.email, p.phone ?? null, p.firstName, p.tags, p.removeTags ?? [], custom, p.pipeline, p.name]))
    .digest("hex")
    .slice(0, 32);
}
