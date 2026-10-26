"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { createGhlSync } from "@/lib/os/integrations/ghl";
import { withStoredQualification, type SyncProviderId } from "@/lib/os/integrations/mapping";
import { friendlyError, type ProviderFields } from "@/lib/os/integrations/provider";
import { enqueueBackfill } from "@/lib/os/integrations/queue";
import { disconnectDataOs, saveDataOs } from "@/lib/os/integrations/dataos";
import { encryptGhl, loadProvider } from "@/lib/os/integrations/store";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

export interface IntegrationActionResult {
  error?: string;
  notice?: string;
}

async function requireManager() {
  const context = await getCurrentWorkspaceContext();
  if (!context) throw new Error("Sign in again.");
  if (!canManageWorkspace(context.role)) throw new Error("Only workspace owners and admins can manage integrations.");
  return context.workspaceId;
}

const providerSchema = z.enum(["kit", "ghl"]);

function done(notice?: string): IntegrationActionResult {
  revalidatePath("/os/settings");
  return notice ? { notice } : {};
}

async function run(fn: () => Promise<IntegrationActionResult>): Promise<IntegrationActionResult> {
  try {
    return await fn();
  } catch (error) {
    return { error: friendlyError(error) };
  }
}

const ghlSchema = z.object({
  token: z.string().trim().min(10, "Paste the private integration token.").max(2048),
  locationId: z.string().trim().min(5, "Paste the location id.").max(100).regex(/^[A-Za-z0-9_-]+$/, "The location id is letters and numbers only."),
});

/** Test the token against the location, then save it encrypted. */
export async function connectGhl(input: { token: string; locationId: string }): Promise<IntegrationActionResult> {
  return run(async () => {
    const workspaceId = await requireManager();
    const parsed = ghlSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the token and location id." };
    await createGhlSync(parsed.data).verify();
    const data = { credentials: encryptGhl(parsed.data), locationId: parsed.data.locationId, lastTestedAt: new Date(), lastError: null };
    await prisma.osIntegration.upsert({
      where: { workspaceId_provider: { workspaceId, provider: "ghl" } },
      create: { workspaceId, provider: "ghl", ...data },
      update: data,
    });
    return done("GoHighLevel connected.");
  });
}

export async function disconnectGhl(): Promise<IntegrationActionResult> {
  return run(async () => {
    const workspaceId = await requireManager();
    // Keep the mapping, drop the secret: reconnecting picks up where it left off.
    await prisma.osIntegration.updateMany({ where: { workspaceId, provider: "ghl" }, data: { credentials: null, lastError: null } });
    return done("GoHighLevel disconnected.");
  });
}

export async function testConnection(provider: SyncProviderId): Promise<IntegrationActionResult> {
  return run(async () => {
    const workspaceId = await requireManager();
    const p = providerSchema.parse(provider);
    const config = await loadProvider(workspaceId, p);
    if (!config) return { error: "Connect it first." };
    let lastError: string | null = null;
    try {
      await config.client.verify();
    } catch (error) {
      lastError = friendlyError(error);
    }
    const data = { lastTestedAt: new Date(), lastError };
    await prisma.osIntegration.upsert({
      where: { workspaceId_provider: { workspaceId, provider: p } },
      create: { workspaceId, provider: p, ...data },
      update: data,
    });
    revalidatePath("/os/settings");
    return lastError ? { error: lastError } : { notice: "Connection works." };
  });
}

/** The provider's custom fields (and GHL pipelines) for the mapping menus. */
export async function loadProviderFields(provider: SyncProviderId): Promise<{ fields?: ProviderFields; error?: string }> {
  try {
    const workspaceId = await requireManager();
    const config = await loadProvider(workspaceId, providerSchema.parse(provider));
    if (!config) return { error: "Connect it first." };
    return { fields: await config.client.listFields() };
  } catch (error) {
    return { error: friendlyError(error) };
  }
}

export async function saveMapping(provider: SyncProviderId, mapping: unknown): Promise<IntegrationActionResult> {
  return run(async () => {
    const workspaceId = await requireManager();
    const p = providerSchema.parse(provider);
    // Custom field targets live on each field now (saved with editField). The
    // legacy qualification mapping is kept as stored, never taken from the form.
    const stored = await prisma.osIntegration.findUnique({ where: { workspaceId_provider: { workspaceId, provider: p } }, select: { mapping: true } });
    const clean = JSON.parse(JSON.stringify(withStoredQualification(mapping, stored?.mapping)));
    await prisma.osIntegration.upsert({
      where: { workspaceId_provider: { workspaceId, provider: p } },
      create: { workspaceId, provider: p, mapping: clean },
      update: { mapping: clean },
    });
    return done("Mapping saved. It applies from the next change.");
  });
}

export async function setSyncEnabled(provider: SyncProviderId, enabled: boolean): Promise<IntegrationActionResult> {
  return run(async () => {
    const workspaceId = await requireManager();
    const p = providerSchema.parse(provider);
    await prisma.osIntegration.upsert({
      where: { workspaceId_provider: { workspaceId, provider: p } },
      create: { workspaceId, provider: p, enabled: Boolean(enabled) },
      update: { enabled: Boolean(enabled) },
    });
    return done(enabled ? "Sync is on." : "Sync is paused.");
  });
}

/** Push everyone already here (sales contacts, or everyone if the mapping says so). */
export async function syncExisting(provider: SyncProviderId): Promise<IntegrationActionResult> {
  return run(async () => {
    const workspaceId = await requireManager();
    const p = providerSchema.parse(provider);
    const config = await loadProvider(workspaceId, p);
    if (!config) return { error: "Connect it first." };
    if (!config.enabled) return { error: "Sync is paused. Turn it on first." };
    const contacts = await prisma.contact.findMany({
      where: {
        workspaceId,
        ...(config.mapping.scope === "sales" ? { kind: "SALES" as const } : {}),
        ...(config.client.requiresEmail ? { email: { not: null } } : {}),
      },
      select: { id: true },
      orderBy: { lastMessageAt: "desc" },
      take: 5000,
    });
    if (!contacts.length) return { notice: config.client.requiresEmail ? "No contacts with an email yet." : "No contacts to send yet." };
    const n = await enqueueBackfill(workspaceId, p, contacts.map((c) => c.id));
    return done(`Sending ${n} ${n === 1 ? "contact" : "contacts"}. Unchanged ones are skipped.`);
  });
}

/** Data OS (Settings › Integrations › Content): save the address and token. */
export async function connectDataOs(input: { baseUrl: string; token?: string }): Promise<IntegrationActionResult> {
  return run(async () => {
    const workspaceId = await requireManager();
    const r = await saveDataOs(workspaceId, input);
    return "error" in r ? { error: r.error } : done("Data OS connected.");
  });
}

export async function removeDataOs(): Promise<IntegrationActionResult> {
  return run(async () => {
    await disconnectDataOs(await requireManager());
    return done("Data OS disconnected.");
  });
}
