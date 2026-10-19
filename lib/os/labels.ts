import type { ContactKind, ContactStage } from "@/app/generated/prisma/enums";

export const kindTabs: { kind: ContactKind; tab: string; label: string }[] = [
  { kind: "SALES", tab: "sales", label: "Sales" },
  { kind: "PERSONAL", tab: "personal", label: "Personal" },
  { kind: "PITCHES", tab: "pitches", label: "Pitches" },
  { kind: "UNSORTED", tab: "unsorted", label: "Unsorted" },
];

export function kindForTab(tab: string | undefined): ContactKind {
  return kindTabs.find((t) => t.tab === tab)?.kind ?? "SALES";
}

export const stageLabels: Record<ContactStage, string> = {
  NEW: "New",
  LEAD_MAGNET_SENT: "Lead magnet sent",
  IN_CONVERSATION: "In conversation",
  QUALIFIED: "Qualified",
  NOT_QUALIFIED: "Not qualified",
  CALL_OFFERED: "Call offered",
  CALL_BOOKED: "Call booked",
  SHOWED: "Showed",
  WON: "Won",
  LOST: "Lost",
};

export const stageOrder = Object.keys(stageLabels) as ContactStage[];

export const entryLabels: Record<string, string> = {
  comment: "Comment",
  keyword_dm: "Keyword DM",
  story_reply: "Story reply",
  setter_comment: "Comment",
};

/** "5m", "3h", "2d", or a date once it is older than a week. */
export function shortAgo(iso: string | null, now: number): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
