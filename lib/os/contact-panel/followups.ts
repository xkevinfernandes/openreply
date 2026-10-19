// Follow-ups tab data and the panel's "next follow-up" line. Wave-0 stub with
// a minimal next-step read; owner: S5.
import type { PanelFollowup } from "@/lib/os/contact-panel/types";

export interface ContactFollowupsData {
  contactId: string;
}

export async function loadContactFollowups(workspaceId: string, contactId: string): Promise<ContactFollowupsData> {
  void workspaceId;
  return { contactId };
}

const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });

/** "Follow-up Wed 10:00" from a due time. */
export function followupLabel(at: Date, timeZone?: string): string {
  const f = timeZone ? new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone }) : DAY;
  return `Follow-up ${f.format(at).replace(",", "")}`;
}

export function nextFollowupLine(step: { dueAt: Date; label?: string | null; sequence?: string | null } | null, timeZone?: string): PanelFollowup | null {
  if (!step) return null;
  return {
    label: followupLabel(step.dueAt, timeZone),
    at: step.dueAt.toISOString(),
    href: "/os/follow-ups?tab=scheduled",
    tip: step.label ? `${step.label} sends if no reply` : null,
  };
}
