// Settings › Connections view model: the stored rows mapped to the brand
// Connection shape (@claudepreneur/brand/react). The board gets status,
// connected as / by / when, last check, last used, at most a key's last four,
// scopes and recent activity. There is no secret field anywhere in this file's
// output (tested in __tests__/os/connections-board.test.ts).
//
// buildConnections is pure; loadServiceStates reads the database.
import { SERVICES, type ServiceId, type ServiceInfo } from "./catalog";

export type BoardStatus = "connected" | "available" | "error" | "attention";

/** The brand Connection, strings only (it crosses to the client). */
export interface BoardConnection {
  id: ServiceId;
  name: string;
  purpose: string;
  category: string;
  logo?: string;
  status: BoardStatus;
  method: ServiceInfo["method"];
  connectedAs?: string;
  connectedBy?: string;
  connectedAt?: string;
  lastSync?: string;
  lastUsed?: string;
  last4?: string;
  scopes: { label: string; detail?: string }[];
  never: string[];
  shared?: boolean;
  usedBy?: string[];
  problem?: string;
  keyHelpHref?: string;
  activity: { when: string; what: string; tone?: "good" | "bad" | "neutral" }[];
}

export interface ServiceEvent {
  kind: string;
  note: string | null;
  at: Date;
  actor: string | null;
}

/** What the database says about one service, before words. */
export interface ServiceState {
  id: ServiceId;
  connected: boolean;
  account?: string | null;
  last4?: string;
  /** Broken: the card turns red with Reconnect. */
  error?: string | null;
  /** Works, but needs a decision (paused, webhook missing, token expiring). */
  attention?: string | null;
  connectedAt?: Date | null;
  connectedBy?: string | null;
  lastCheckedAt?: Date | null;
  lastUsedAt?: Date | null;
  events?: ServiceEvent[];
}

export function ago(at: Date | null | undefined, now: Date): string | undefined {
  if (!at) return undefined;
  const mins = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return dayLabel(at);
}

export function dayLabel(at: Date | null | undefined): string | undefined {
  if (!at) return undefined;
  return at.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

const EVENT_WORDS: Record<string, { what: string; tone: "good" | "bad" | "neutral" }> = {
  connect: { what: "Connected", tone: "good" },
  check: { what: "Checked", tone: "good" },
  fail: { what: "Check failed", tone: "bad" },
  disconnect: { what: "Disconnected", tone: "neutral" },
  revoke_failed: { what: "Couldn't clean up at the provider", tone: "bad" },
  deauthorized: { what: "Removed on the provider's side", tone: "neutral" },
};

function eventLine(e: ServiceEvent, now: Date): BoardConnection["activity"][number] {
  const w = EVENT_WORDS[e.kind] ?? { what: e.kind, tone: "neutral" as const };
  const bits = [w.what, e.actor ? `by ${e.actor}` : null].filter(Boolean).join(" ");
  return { when: ago(e.at, now) ?? "", what: e.note ? `${bits}: ${e.note}` : bits, tone: w.tone };
}

export function buildConnection(info: ServiceInfo, state: ServiceState | undefined, now: Date): BoardConnection {
  const s = state ?? { id: info.id, connected: false };
  const status: BoardStatus = !s.connected ? "available" : s.error ? "error" : s.attention ? "attention" : "connected";
  const out: BoardConnection = {
    id: info.id,
    name: info.name,
    purpose: info.purpose,
    category: info.category,
    status,
    method: info.method,
    scopes: info.scopes.map((x) => ({ ...x })),
    never: [...info.never],
    activity: (s.events ?? []).slice(0, 6).map((e) => eventLine(e, now)),
  };
  if (info.logo) out.logo = info.logo;
  if (info.shared) {
    out.shared = true;
    out.usedBy = [...(info.usedBy ?? [])];
  }
  if (info.keyHelpHref) out.keyHelpHref = info.keyHelpHref;
  if (s.connected) {
    if (s.account) out.connectedAs = s.account;
    if (s.connectedBy) out.connectedBy = s.connectedBy;
    const at = dayLabel(s.connectedAt);
    if (at) out.connectedAt = at;
    const checked = ago(s.lastCheckedAt, now);
    if (checked) out.lastSync = checked;
    const used = ago(s.lastUsedAt, now);
    if (used) out.lastUsed = used;
    if (info.method === "key" && s.last4) out.last4 = s.last4.slice(-4);
    const problem = s.error ?? s.attention;
    if (problem) out.problem = problem;
  }
  return out;
}

export function buildConnections(states: ServiceState[], now: Date): BoardConnection[] {
  const byId = new Map(states.map((s) => [s.id, s]));
  return SERVICES.map((info) => buildConnection(info, byId.get(info.id), now));
}
