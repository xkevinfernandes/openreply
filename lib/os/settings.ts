// Settings: tabs, DM log status filters and the diagnostics verdict. Pure, so
// it's testable; the screens call OpenReply's /api/logs and
// /api/admin/diagnostics for the data.

export const SETTINGS_TABS = [
  { tab: "instagram", label: "Instagram" },
  { tab: "logs", label: "DM logs" },
  { tab: "diagnostics", label: "Diagnostics" },
  { tab: "workspace", label: "Workspace" },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]["tab"];

export function parseSettingsTab(value: string | null | undefined): SettingsTab {
  return SETTINGS_TABS.some((t) => t.tab === value) ? (value as SettingsTab) : "instagram";
}

/** DmStatus values (prisma/schema.prisma) in the order the filter shows them. */
export const DM_STATUSES = ["SENT", "FAILED", "PENDING", "SKIPPED_DEDUP", "SKIPPED_RATE_LIMIT", "SKIPPED_PLAN_LIMIT", "SKIPPED_NO_MATCH"] as const;
export type DmStatusValue = (typeof DM_STATUSES)[number];

export const DM_STATUS_LABEL: Record<DmStatusValue, string> = {
  SENT: "Sent",
  FAILED: "Failed",
  PENDING: "Pending",
  SKIPPED_DEDUP: "Already sent",
  SKIPPED_RATE_LIMIT: "Rate limited",
  SKIPPED_PLAN_LIMIT: "Over limit",
  SKIPPED_NO_MATCH: "No match",
};

/** The dot colour for a status: good, bad, waiting or quiet. */
export function dmStatusTone(status: string): "good" | "bad" | "wait" | "quiet" {
  if (status === "SENT") return "good";
  if (status === "FAILED") return "bad";
  if (status === "PENDING") return "wait";
  return "quiet";
}

export function dmStatusLabel(status: string): string {
  return (DM_STATUS_LABEL as Record<string, string>)[status] ?? status;
}

/** The filter chips: "all" plus the statuses that mean something day to day. */
export const LOG_FILTERS: { value: "all" | DmStatusValue; label: string }[] = [
  { value: "all", label: "All" },
  { value: "SENT", label: "Sent" },
  { value: "FAILED", label: "Failed" },
  { value: "PENDING", label: "Pending" },
  { value: "SKIPPED_DEDUP", label: "Already sent" },
  { value: "SKIPPED_RATE_LIMIT", label: "Rate limited" },
  { value: "SKIPPED_NO_MATCH", label: "No match" },
];

export function logsQuery(status: string, page: number, limit = 25): string {
  const p = new URLSearchParams({ page: String(Math.max(1, Math.floor(page) || 1)), limit: String(limit) });
  if ((DM_STATUSES as readonly string[]).includes(status)) p.set("status", status);
  return p.toString();
}

export interface DiagnosticsSummaryInput {
  workerHealthy: boolean;
  workerAgeMs: number | null;
  queue: Partial<Record<"waiting" | "active" | "delayed" | "failed", number>>;
  webhookFailures: number;
  dmFailures: number;
  tokenRefreshFailures: number;
}

/** One line for the top of Diagnostics: is the sending pipeline OK? */
export function diagnosticsVerdict(d: DiagnosticsSummaryInput): { tone: "good" | "warn" | "bad"; text: string } {
  if (!d.workerHealthy) {
    return {
      tone: "bad",
      text: d.workerAgeMs == null ? "The worker isn't running. No DMs will send." : "The worker stopped checking in. DMs may be stuck.",
    };
  }
  if (d.tokenRefreshFailures > 0) return { tone: "bad", text: "Instagram token refresh is failing. Reconnect the account." };
  const backlog = (d.queue.waiting ?? 0) + (d.queue.delayed ?? 0);
  const problems: string[] = [];
  if ((d.queue.failed ?? 0) > 0) problems.push(`${d.queue.failed} failed job${d.queue.failed === 1 ? "" : "s"} in the queue`);
  if (d.webhookFailures > 0) problems.push(`${d.webhookFailures} webhook${d.webhookFailures === 1 ? "" : "s"} failed`);
  if (d.dmFailures > 0) problems.push("recent DMs didn't send");
  if (backlog > 50) problems.push(`${backlog} DMs waiting`);
  if (problems.length) return { tone: "warn", text: `Running, but ${problems.join(", ")}.` };
  return { tone: "good", text: "Everything's running." };
}

/** "12s ago", "4 min ago", "3 h ago". */
export function ago(ms: number | null): string {
  if (ms == null) return "never";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
