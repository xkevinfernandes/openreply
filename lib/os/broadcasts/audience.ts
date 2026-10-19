// Who a broadcast run goes to. Pure.
//   - contacts carrying the audience tag (follow-up-friday)
//   - minus paused contacts, Personal and Pitches
//   - nobody while Pause all is on
//   - only people inside Instagram's 24h messaging window at send time;
//     everyone else is listed as "outside window" and skipped. No HUMAN_AGENT
//     broadcasts (plan "Defaults" 4).

import { windowState, type StateConfig } from "@/lib/os/setter/state";
import type { BroadcastContact } from "@/lib/os/broadcasts/types";

export type AudienceVerdict = "eligible" | "outside_window" | "excluded";

export interface AudienceEntry {
  contact: BroadcastContact;
  verdict: AudienceVerdict;
  /** Why outside / excluded. */
  reason: string | null;
  /** When their free window closes (ISO); eligible only. */
  deadline: string | null;
}

export interface AudienceResult {
  eligible: AudienceEntry[];
  outside: AudienceEntry[];
  excluded: AudienceEntry[];
}

/** Why a tagged contact is never sent a broadcast (null = fine). */
export function excludedReason(c: Pick<BroadcastContact, "kind" | "paused">): string | null {
  if (c.paused) return "Paused";
  if (c.kind === "PERSONAL") return "Personal";
  if (c.kind === "PITCHES") return "Pitches";
  return null;
}

/** O3: someone mid-workflow who heard from us (or wrote) in the last 48h isn't sent Friday's message. */
export const WORKFLOW_QUIET_MS = 48 * 3600_000;
export function workflowBusy(c: Pick<BroadcastContact, "inWorkflow" | "theirLastAt" | "ourLastAt">, at: Date): boolean {
  if (!c.inWorkflow) return false;
  const last = Math.max(c.theirLastAt ? Date.parse(c.theirLastAt) : 0, c.ourLastAt ? Date.parse(c.ourLastAt) : 0);
  return at.getTime() - last < WORKFLOW_QUIET_MS;
}

/**
 * Split the tagged contacts. The window is read at `from` (the window start,
 * or now when the run is already under way): eligible means their free 24h
 * window is still open then, and `deadline` is when it closes (capped at the
 * end of the send window).
 */
export function selectAudience(
  contacts: BroadcastContact[],
  opts: { tag: string; from: Date; until: Date; pausedAll?: boolean; cfg?: StateConfig }
): AudienceResult {
  const out: AudienceResult = { eligible: [], outside: [], excluded: [] };
  const tag = opts.tag.toLowerCase();
  for (const c of contacts) {
    if (!c.tags.some((t) => t.toLowerCase() === tag)) continue;
    const ex = opts.pausedAll ? "Pause all is on" : (excludedReason(c) ?? (workflowBusy(c, opts.from) ? "In a workflow" : null));
    if (ex) {
      out.excluded.push({ contact: c, verdict: "excluded", reason: ex, deadline: null });
      continue;
    }
    const [state, until] = windowState(c.theirLastAt, opts.from, opts.cfg);
    if (state !== "free" || !until) {
      out.outside.push({ contact: c, verdict: "outside_window", reason: c.theirLastAt ? "Last wrote over 24h before the send" : "Never wrote to you", deadline: null });
      continue;
    }
    const deadline = new Date(Math.min(new Date(until).getTime(), opts.until.getTime())).toISOString();
    out.eligible.push({ contact: c, verdict: "eligible", reason: null, deadline });
  }
  const byName = (a: AudienceEntry, b: AudienceEntry) => (a.contact.username ?? "").localeCompare(b.contact.username ?? "");
  out.eligible.sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? "") || byName(a, b));
  out.outside.sort(byName);
  out.excluded.sort(byName);
  return out;
}

/** Re-check one person right before a send (the window moves while we wait). */
export function stillInWindow(theirLastAt: string | null, at: Date, cfg?: StateConfig): boolean {
  return windowState(theirLastAt, at, cfg)[0] === "free";
}
