// Automations: the OpenReply campaign list as the DM OS shows it. Pure logic
// only (the row shape, "action needed", filters and search) so it can be
// tested without a database. The loader is lib/os/automations-data.ts.

export type AutomationFilter = "all" | "active" | "inactive" | "action";

export const AUTOMATION_FILTERS: { value: AutomationFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "action", label: "Action needed" },
];

export function parseFilter(value: string | null | undefined): AutomationFilter {
  return AUTOMATION_FILTERS.some((f) => f.value === value) ? (value as AutomationFilter) : "all";
}

/** What one campaign triggers on, enough to spot two campaigns fighting over a keyword. */
export interface TriggerShape {
  id: string;
  name: string;
  instagramAccountId: string;
  isActive: boolean;
  keywords: string[];
  matchAnyWord: boolean;
  postId: string | null;
  matchAnyPost: boolean;
  pendingNextReel: boolean;
  dmTriggerEnabled: boolean;
}

/** The state of the IG account a campaign sends from. */
export interface AccountHealth {
  provider: "META" | "ZERNIO";
  tokenExpiresAt: Date | null;
  webhookSubscribed: boolean;
  zernioAccountId: string | null;
}

export interface WorkspaceHealth {
  /** A ZernioConnection with its webhook registered. */
  zernioReady: boolean;
  kitConnected: boolean;
}

export interface ActionInput extends TriggerShape {
  requireEmail: boolean;
  /** FAILED DmLogs in the last 7 days. */
  recentFailures: number;
  /** null when the account row is gone. */
  account: AccountHealth | null;
}

export const RECENT_FAILURE_DAYS = 7;

/** Problems with the account itself; shared by every campaign on it. */
export function accountProblems(account: AccountHealth | null, ws: WorkspaceHealth, now: Date): string[] {
  if (!account) return ["Instagram account is disconnected"];
  const out: string[] = [];
  if (account.provider === "ZERNIO") {
    if (!ws.zernioReady) out.push("Zernio isn't set up");
    else if (!account.zernioAccountId) out.push("Instagram account isn't linked in Zernio");
  } else if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() < now.getTime()) {
    out.push("Instagram token expired");
  }
  if (!account.webhookSubscribed) out.push("Instagram webhook isn't subscribed");
  return out;
}

function hasPostTrigger(t: TriggerShape) {
  return t.matchAnyPost || Boolean(t.postId) || t.pendingNextReel;
}

/** True when a comment or DM could fire both campaigns. */
export function triggersOverlap(a: TriggerShape, b: TriggerShape): boolean {
  if (a.instagramAccountId !== b.instagramAccountId) return false;
  if (a.dmTriggerEnabled && b.dmTriggerEnabled) return true;
  if (!hasPostTrigger(a) || !hasPostTrigger(b)) return false;
  if (a.matchAnyPost || b.matchAnyPost) return true;
  return Boolean(a.postId) && a.postId === b.postId;
}

const norm = (k: string) => k.trim().toLowerCase();

/** Keywords this campaign shares with another active, overlapping campaign. */
export function keywordClashes(self: TriggerShape, all: TriggerShape[]): { keyword: string; with: string }[] {
  if (!self.isActive || self.matchAnyWord) return [];
  const mine = new Set(self.keywords.map(norm).filter(Boolean));
  const out: { keyword: string; with: string }[] = [];
  for (const other of all) {
    if (other.id === self.id || !other.isActive || !triggersOverlap(self, other)) continue;
    // "Any word" on an overlapping campaign swallows every keyword we have.
    const shared = other.matchAnyWord ? [...mine] : other.keywords.map(norm).filter((k) => mine.has(k));
    for (const keyword of shared) out.push({ keyword, with: other.name });
  }
  return out;
}

/**
 * Why a campaign needs Kevin's attention, in plain words. Empty = fine.
 * A paused campaign never needs action: nothing is running.
 */
export function actionNeeded(c: ActionInput, all: TriggerShape[], ws: WorkspaceHealth, now: Date): string[] {
  if (!c.isActive) return [];
  const out = accountProblems(c.account, ws, now);
  if (c.recentFailures > 0) {
    out.push(`${c.recentFailures} DM${c.recentFailures === 1 ? "" : "s"} failed in the last ${RECENT_FAILURE_DAYS} days`);
  }
  if (c.requireEmail && !ws.kitConnected) out.push("Email gate is on but Kit isn't connected");
  if (!hasPostTrigger(c) && !c.dmTriggerEnabled) out.push("No post or DM trigger");
  const clash = keywordClashes(c, all)[0];
  if (clash) out.push(`“${clash.keyword}” is also a keyword in ${clash.with}`);
  return out;
}

/** One row of the Automations list. */
export interface AutomationRow {
  id: string;
  name: string;
  instagramAccountId: string;
  username: string | null;
  postId: string | null;
  postUrl: string | null;
  matchAnyPost: boolean;
  pendingNextReel: boolean;
  dmTriggerEnabled: boolean;
  keywords: string[];
  matchAnyWord: boolean;
  /** The first DM they get: the opening DM when on, else the link DM. */
  opener: string;
  requireEmail: boolean;
  requireFollow: boolean;
  isActive: boolean;
  setter: { id: string; name: string; viaCampaign: boolean } | null;
  runs: number;
  sent: number;
  failed: number;
  clicks: number;
  ctr: number;
  actions: string[];
  createdAt: string;
}

export function matchesQuery(row: AutomationRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.name, row.opener, row.username ?? "", row.setter?.name ?? "", ...row.keywords].some((s) => s.toLowerCase().includes(q));
}

export function matchesFilter(row: AutomationRow, filter: AutomationFilter): boolean {
  switch (filter) {
    case "active":
      return row.isActive;
    case "inactive":
      return !row.isActive;
    case "action":
      return row.actions.length > 0;
    default:
      return true;
  }
}

export function filterRows(rows: AutomationRow[], filter: AutomationFilter, query: string): AutomationRow[] {
  return rows.filter((r) => matchesFilter(r, filter) && matchesQuery(r, query));
}

export function filterCounts(rows: AutomationRow[]): Record<AutomationFilter, number> {
  return {
    all: rows.length,
    active: rows.filter((r) => r.isActive).length,
    inactive: rows.filter((r) => !r.isActive).length,
    action: rows.filter((r) => r.actions.length > 0).length,
  };
}

/** "Comments on one post", "any post", "next reel", plus "DMs". */
export function triggerLabel(row: Pick<AutomationRow, "postId" | "matchAnyPost" | "pendingNextReel" | "dmTriggerEnabled">): string {
  const parts: string[] = [];
  if (row.matchAnyPost) parts.push("Any post");
  else if (row.pendingNextReel) parts.push("Next reel");
  else if (row.postId) parts.push("One post");
  if (row.dmTriggerEnabled) parts.push("DMs");
  return parts.join(" + ") || "No trigger";
}
