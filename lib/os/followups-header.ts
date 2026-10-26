// Follow-ups header: where sequences are set up (the default setter's
// Follow-ups in Knowledge bases) and Follow-up Friday's next run.

import { prisma } from "@/lib/db/client";
import { nextRunDate } from "@/lib/os/home";
import { defaultSetterId } from "@/lib/os/setter/setters";

export const FRIDAY_KEY = "follow-up-friday";

export interface FollowupsHeader {
  /** The default setter's Follow-ups (knowledge tree link), else Knowledge bases. */
  setupHref: string;
  friday: { name: string; href: string; on: boolean; when: string } | null;
}

/** Pure: "Fri 24 Oct" (or "Today") for a YYYY-MM-DD run date. */
export function runLabel(date: string, today: boolean): string {
  if (today) return "Today";
  const d = new Date(`${date}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(d).replace(",", "");
}

export async function loadFollowupsHeader(workspaceId: string, now = new Date()): Promise<FollowupsHeader> {
  const [setterId, friday] = await Promise.all([
    defaultSetterId(workspaceId).catch(() => null),
    prisma.broadcast
      .findUnique({
        where: { workspaceId_key: { workspaceId, key: FRIDAY_KEY } },
        select: { key: true, name: true, status: true, sendDate: true, windowStart: true, windowEnd: true, timezone: true },
      })
      .catch(() => null),
  ]);
  let fri: FollowupsHeader["friday"] = null;
  if (friday) {
    // One-off broadcasts (dm-crm slice 5): the kept weekly draft has no date;
    // the header still points at it and at the next Friday.
    const next = nextRunDate(5, friday.windowEnd, friday.timezone, now);
    fri = {
      name: friday.name,
      href: `/os/automations/broadcasts/${friday.key}`,
      on: friday.status !== "draft" && friday.status !== "cancelled",
      when: `${runLabel(next.date, next.today)}, ${friday.windowStart}`,
    };
  }
  return { setupHref: setterId ? `/os/knowledge/${setterId}?s=booking#followups` : "/os/knowledge", friday: fri };
}
