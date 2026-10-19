// Knowledge bases, the database half: which setter answers a contact, loading
// it for J, and the one-time import from the bundled markdown.
//
// Which setter answers (spec item 13), first match wins:
//   1. the contact's own setterId (it remembers its setter)
//   2. a campaign override: they came in through an OpenReply automation that
//      is mapped to a setter (CampaignSetter); remembered on the contact
//   3. the default setter of their IG account
//   4. the workspace default, then the oldest setter
//   5. no Setter row in the workspace at all: the file fallback
//      (lib/os/setter/knowledge.ts), so J keeps drafting before the import.

import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { resolvedFromRows, resourceFromCatalog, rowDataFromProfile, type KnowledgeSource, type ResolvedSetter } from "@/lib/os/setter/kb";
import { fileSetter, loadCatalog, loadKnowledge } from "@/lib/os/setter/knowledge";
import { fieldsForSetter, loadDocs } from "@/lib/os/setter/knowledge/doc-store";
import { profileFromFiles } from "@/lib/os/setter/profile";
import type { SetterContact } from "@/lib/os/setter/store";

async function loadResolved(workspaceId: string, setterId: string): Promise<ResolvedSetter | null> {
  const setter = await prisma.setter.findFirst({ where: { id: setterId, workspaceId }, include: { resources: { select: { resourceId: true } } } });
  if (!setter) return null;
  const [resources, docs, fields] = await Promise.all([
    prisma.resource.findMany({ where: { workspaceId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    // Docs and fields are additive: if they can't load, J still has the JSON.
    loadDocs(setter.id).catch(() => ({})),
    fieldsForSetter(setter.id).catch(() => []),
  ]);
  return resolvedFromRows(
    setter,
    resources,
    setter.resources.map((r) => r.resourceId),
    { docs, fields }
  );
}

/** The campaign that brought this person in, if it is mapped to a setter. */
async function campaignSetterId(contact: SetterContact): Promise<string | null> {
  const maps = await prisma.campaignSetter.findMany({ where: { workspaceId: contact.workspaceId }, select: { automationId: true, setterId: true } });
  if (!maps.length) return null;
  const log = await prisma.dmLog.findFirst({
    where: {
      workspaceId: contact.workspaceId,
      commenterId: contact.igUserId,
      automationId: { in: maps.map((m) => m.automationId) },
      ...(contact.instagramAccountId ? { instagramAccountId: contact.instagramAccountId } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { automationId: true },
  });
  return log ? (maps.find((m) => m.automationId === log.automationId)?.setterId ?? null) : null;
}

/** Steps 3-4: the default for an IG account (or the workspace). */
export async function defaultSetterId(workspaceId: string, instagramAccountId?: string | null): Promise<string | null> {
  if (instagramAccountId) {
    const own = await prisma.setter.findFirst({ where: { workspaceId, instagramAccountId, isDefault: true }, select: { id: true } });
    if (own) return own.id;
  }
  const ws =
    (await prisma.setter.findFirst({ where: { workspaceId, isDefault: true }, orderBy: { createdAt: "asc" }, select: { id: true } })) ??
    (await prisma.setter.findFirst({ where: { workspaceId }, orderBy: { createdAt: "asc" }, select: { id: true } }));
  return ws?.id ?? null;
}

export async function resolveSetterId(contact: SetterContact): Promise<string | null> {
  if (contact.setterId) {
    const own = await prisma.setter.findFirst({ where: { id: contact.setterId, workspaceId: contact.workspaceId }, select: { id: true } });
    if (own) return own.id;
  }
  const fromCampaign = await campaignSetterId(contact);
  if (fromCampaign) {
    // Remember it (updateMany: a sample contact that isn't in the DB is a no-op).
    await prisma.contact.updateMany({ where: { id: contact.id, workspaceId: contact.workspaceId }, data: { setterId: fromCampaign } });
    return fromCampaign;
  }
  return defaultSetterId(contact.workspaceId, contact.instagramAccountId);
}

export const dbKnowledge: KnowledgeSource = {
  async forContact(contact) {
    const id = await resolveSetterId(contact);
    if (id) {
      const r = await loadResolved(contact.workspaceId, id);
      if (r) return r;
    }
    return fileSetter();
  },
  async forSetter(workspaceId, setterId) {
    return loadResolved(workspaceId, setterId);
  },
};

// ---------------------------------------------------------------- import
export interface ImportResult {
  setterId: string;
  created: boolean;
  resources: number;
}

/**
 * Import the bundled markdown (lib/os/setter/knowledge/<client>/) into a
 * Setter + Resources for a workspace. Resources upsert by slug. The setter is
 * created once; with `overwrite` an existing one of the same name is replaced.
 * Every lead magnet is switched on for the new setter (J saw them all before).
 */
export async function importFromFiles(
  workspaceId: string,
  opts: { clientId?: string; overwrite?: boolean; name?: string } = {}
): Promise<ImportResult> {
  const clientId = opts.clientId ?? "claudepreneur";
  const profile = profileFromFiles(loadKnowledge(clientId));
  const catalog = loadCatalog(clientId);
  if (catalog.tag_options?.length && !profile.settings.tag_options) profile.settings.tag_options = catalog.tag_options;
  // The Zernio env names are deploy config, not knowledge.
  delete (profile.settings as Record<string, unknown>).zernio;
  profile.name = opts.name ?? (profile.name === "default" ? "Default" : profile.name);

  return prisma.$transaction(async (tx) => {
    const resourceIds: string[] = [];
    for (const [i, row] of catalog.resources.entries()) {
      const r = resourceFromCatalog(row);
      const data = { ...r, data: r.data as Prisma.InputJsonValue, sortOrder: i };
      const saved = await tx.resource.upsert({
        where: { workspaceId_slug: { workspaceId, slug: r.slug } },
        create: { workspaceId, ...data },
        update: data,
      });
      if (r.kind === "resource") resourceIds.push(saved.id);
    }

    const cols = rowDataFromProfile(profile);
    const json = {
      ...cols,
      settings: cols.settings as Prisma.InputJsonValue,
      business: cols.business as Prisma.InputJsonValue,
      offers: cols.offers as Prisma.InputJsonValue,
      funnel: cols.funnel as Prisma.InputJsonValue,
      voiceCorrections: cols.voiceCorrections as Prisma.InputJsonValue,
      autonomy: profile.settings.autonomy === "auto" ? ("AUTO" as const) : ("APPROVE" as const),
    };
    const existing = await tx.setter.findFirst({ where: { workspaceId, name: profile.name } });
    const hasDefault = await tx.setter.findFirst({ where: { workspaceId, isDefault: true }, select: { id: true } });
    let setterId: string;
    let created = false;
    if (existing && !opts.overwrite) {
      setterId = existing.id;
    } else if (existing) {
      setterId = (await tx.setter.update({ where: { id: existing.id }, data: json })).id;
    } else {
      setterId = (await tx.setter.create({ data: { workspaceId, ...json, isDefault: !hasDefault } })).id;
      created = true;
    }
    if (created || opts.overwrite) {
      await tx.setterResource.createMany({ data: resourceIds.map((resourceId) => ({ setterId, resourceId })), skipDuplicates: true });
    }
    return { setterId, created, resources: catalog.resources.length };
  });
}
