import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import type { CrmProvider } from "@/app/generated/prisma/client";
import { createKitClient } from "./kit";
import type { CrmLead, CrmProviderClient } from "./types";

export type { CrmLead, CrmProviderClient, CrmTag } from "./types";

export function createCrmClient(provider: CrmProvider, apiKey: string): CrmProviderClient {
  switch (provider) {
    case "KIT":
      return createKitClient(apiKey);
  }
}

export async function getWorkspaceCrm(workspaceId: string): Promise<CrmProviderClient | null> {
  const connection = await prisma.crmConnection.findFirst({ where: { workspaceId }, orderBy: { createdAt: "asc" } });
  if (!connection) return null;
  return createCrmClient(connection.provider, decryptToken(connection.apiKey));
}

/// Push one captured lead into the workspace's list. Never throws: a list outage
/// must not stop the person from getting the link they asked for.
export async function syncLead(workspaceId: string, lead: CrmLead): Promise<{ ok: boolean; error?: string }> {
  try {
    const crm = await getWorkspaceCrm(workspaceId);
    if (!crm) return { ok: false, error: "No email list connected" };
    await crm.upsertLead(lead);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Email list sync failed" };
  }
}
