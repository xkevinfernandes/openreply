// The contact panel (Inbox right pane, Contacts push panel). Wave-0 contract;
// owner: F. Tabs are filled by their streams (chat S1, details/activity S3,
// follow-ups S5) through their own sub-loaders.
import type { ContactKind } from "@/app/generated/prisma/enums";
import type { FunnelColumn } from "@/lib/os/funnel";
import type { MoveTarget } from "@/lib/os/move-table";

/** What the stage dropdown may offer now, and the won offer (dm-crm 020). */
export interface PanelStageExtras {
  /** One per column: allowed or why not (lib/os/move-table.ts moveTargets). */
  targets: MoveTarget[];
  /** On Won: the offer and the formatted amount (null amount = not filled in). */
  won: { offer: string; amount: string | null } | null;
}

export const PANEL_TABS = [
  { key: "chat", label: "Chat" },
  { key: "details", label: "Details" },
  { key: "followups", label: "Follow-ups" },
  { key: "activity", label: "Activity" },
] as const;

export type PanelTab = (typeof PANEL_TABS)[number]["key"];

export function panelTab(v: string | null | undefined, fallback: PanelTab = "details"): PanelTab {
  return (PANEL_TABS.find((t) => t.key === v)?.key ?? fallback) as PanelTab;
}

export interface PanelField {
  key: string;
  label: string;
  value: string | null;
  /** J filled it from the chat. */
  byJ: boolean;
}

export interface PanelKeyword {
  /** The keyword, or "Story reply" for a story-reply entry. */
  word: string;
  surface: "comment" | "dm" | "story_reply";
  /** The lead magnet it maps to (CampaignResource, else the automation link). */
  resource: string | null;
  at: string | null;
  /** Hover text, e.g. the story caption. */
  title?: string | null;
}

export interface PanelFollowup {
  /** "Follow-up Wed 10:00" */
  label: string;
  at: string;
  /** Where the sequence is defined (FollowupsA). */
  href: string;
  tip: string | null;
}

export interface ContactPanelData {
  contactId: string;
  conversationId: string | null;
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  kind: ContactKind;
  setter: { id: string | null; name: string } | null;
  /** The pill: the setter's funnel columns and where they sit. */
  stage: { column: string; columns: FunnelColumn[] } & Partial<PanelStageExtras>;
  fields: PanelField[];
  keywords: PanelKeyword[];
  nextFollowup: PanelFollowup | null;
}
