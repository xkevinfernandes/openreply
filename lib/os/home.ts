import { prisma } from "@/lib/db/client";

const DAY = 24 * 60 * 60 * 1000;

export async function getHomeStats(workspaceId: string) {
  const now = new Date();
  const since = new Date(now.getTime() - 7 * DAY);
  const [activeCampaigns, dmsSent, sales, unsorted] = await Promise.all([
    prisma.automation.count({ where: { workspaceId, isActive: true } }),
    prisma.dmLog.count({ where: { workspaceId, status: "SENT", dmSentAt: { gte: since } } }),
    prisma.contact.count({ where: { workspaceId, kind: "SALES" } }),
    prisma.contact.count({ where: { workspaceId, kind: "UNSORTED" } }),
  ]);

  return {
    today: now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }),
    stats: [
      { label: "Active automations", value: activeCampaigns },
      { label: "DMs sent, last 7 days", value: dmsSent },
      { label: "Sales contacts", value: sales },
      { label: "Unsorted contacts", value: unsorted },
    ],
  };
}
