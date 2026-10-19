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
  /** Keyword → lead magnet (CampaignResource, else resolved from the link). */
  resource?: { id: string; name: string; viaLink: boolean } | null;
  /** The link they get (first tracked link, else the first URL in the DM). */
  link?: string | null;
  /** An opener A/B test is running on this campaign. */
  ab?: boolean;
  /** Distinct people who triggered it, replied (a conversation started) and booked. */
  replied?: number;
  booked?: number;
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

// --- Campaigns tab (AutomationsA board) -----------------------------------------

/** Filter chips by trigger type. Upstream has no story trigger yet, so Stories is 0. */
export type TriggerChip = "all" | "stories" | "reels" | "posts" | "dm";

export const TRIGGER_CHIPS: { value: TriggerChip; label: string }[] = [
  { value: "all", label: "All" },
  { value: "stories", label: "Stories" },
  { value: "reels", label: "Reels" },
  { value: "posts", label: "Posts" },
  { value: "dm", label: "DM keyword" },
];

export function parseChip(v: string | null | undefined): TriggerChip {
  return TRIGGER_CHIPS.some((c) => c.value === v) ? (v as TriggerChip) : "all";
}

type ChipShape = Pick<AutomationRow, "postId" | "postUrl" | "matchAnyPost" | "pendingNextReel" | "dmTriggerEnabled">;

const isReelUrl = (url: string | null) => !!url && /\/reels?\//i.test(url);

/** Which chips a campaign belongs to (a post campaign can also take DMs). */
export function triggerKinds(row: ChipShape): Exclude<TriggerChip, "all">[] {
  const out: Exclude<TriggerChip, "all">[] = [];
  if (row.pendingNextReel || (row.postId && isReelUrl(row.postUrl))) out.push("reels");
  else if (row.postId || row.matchAnyPost) out.push("posts");
  if (row.dmTriggerEnabled) out.push("dm");
  return out;
}

export function matchesChip(row: ChipShape, chip: TriggerChip): boolean {
  return chip === "all" || (triggerKinds(row) as TriggerChip[]).includes(chip);
}

export function chipCounts(rows: ChipShape[]): Record<TriggerChip, number> {
  const out: Record<TriggerChip, number> = { all: rows.length, stories: 0, reels: 0, posts: 0, dm: 0 };
  for (const r of rows) for (const k of triggerKinds(r)) out[k]++;
  return out;
}

/** "Comment on post" + "Reel · AI setter demo". */
export function triggerSummary(row: ChipShape & Pick<AutomationRow, "name">): { trigger: string; where: string } {
  const kinds = triggerKinds(row);
  if (row.matchAnyPost) return { trigger: "Comment on post", where: kinds.includes("dm") ? "Any post · DMs too" : "Any post" };
  if (row.pendingNextReel) return { trigger: "Comment on post", where: "Next reel" };
  if (row.postId) {
    const where = `${isReelUrl(row.postUrl) ? "Reel" : "Post"} · ${row.name}`;
    return { trigger: "Comment on post", where: kinds.includes("dm") ? `${where} · DMs too` : where };
  }
  if (row.dmTriggerEnabled) return { trigger: "DM keyword", where: row.name };
  return { trigger: "No trigger", where: row.name };
}

/** The first URL in a message. */
export function firstUrl(text: string | null | undefined): string | null {
  const m = (text ?? "").match(/https?:\/\/[^\s<>"')]+/i);
  return m ? m[0].replace(/[.,!?]+$/, "") : null;
}

/** "claudepreneur.com/starter" from a full URL. */
export function shortLink(url: string | null): string | null {
  if (!url) return null;
  return url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
}

export interface StatsLog {
  automationId: string;
  instagramAccountId: string;
  commenterId: string;
}

/**
 * Pure: per campaign, how many distinct people who triggered it went on to a
 * conversation and a booked call. A person counts for every campaign they
 * triggered.
 */
export function campaignStats(
  logs: StatsLog[],
  contacts: { id: string; instagramAccountId: string; igUserId: string }[],
  events: { contactId: string | null; kind: string }[]
): Map<string, { replied: number; booked: number }> {
  const contactOf = new Map(contacts.map((c) => [`${c.instagramAccountId}:${c.igUserId}`, c.id]));
  const replied = new Set(events.filter((e) => e.kind === "conversation_started" && e.contactId).map((e) => e.contactId!));
  const booked = new Set(events.filter((e) => e.kind === "call_booked" && e.contactId).map((e) => e.contactId!));
  const people = new Map<string, Set<string>>();
  for (const l of logs) {
    const id = contactOf.get(`${l.instagramAccountId}:${l.commenterId}`);
    if (!id) continue;
    const set = people.get(l.automationId) ?? new Set<string>();
    set.add(id);
    people.set(l.automationId, set);
  }
  const out = new Map<string, { replied: number; booked: number }>();
  for (const [automationId, ids] of people) {
    let r = 0;
    let b = 0;
    for (const id of ids) {
      if (replied.has(id)) r++;
      if (booked.has(id)) b++;
    }
    out.set(automationId, { replied: r, booked: b });
  }
  return out;
}

/** Pure: the campaign's resource: its CampaignResource row, else the catalog entry its link points at. */
export function campaignResource(
  automationId: string,
  mapped: Map<string, string>,
  resources: { id: string; name: string }[],
  resolvedFromLink: { id: string } | null
): NonNullable<AutomationRow["resource"]> | null {
  const byId = new Map(resources.map((r) => [r.id, r]));
  const own = byId.get(mapped.get(automationId) ?? "");
  if (own) return { id: own.id, name: own.name, viaLink: false };
  const linked = resolvedFromLink ? byId.get(resolvedFromLink.id) : undefined;
  return linked ? { id: linked.id, name: linked.name, viaLink: true } : null;
}
