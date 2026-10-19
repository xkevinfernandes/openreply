// Read side of the Knowledge bases screens: plain serialisable views for the
// pages and client components. Writes are in app/(os)/os/knowledge/actions.ts.

import { prisma } from "@/lib/db/client";
import { offerIsOpen, type SetterProfile } from "@/lib/os/setter/profile";
import { profileFromRow, type ResourceStatusName } from "@/lib/os/setter/kb";
import { resolveSequenceSet, type SequenceSet } from "@/lib/os/sequences/types";

export interface ResourceView {
  id: string;
  slug: string;
  kind: "resource" | "setter";
  name: string;
  link: string | null;
  keyword: string | null;
  status: ResourceStatusName;
  description: string;
  /** How many setters may offer it. */
  setterCount: number;
}

export interface SetterCard {
  id: string;
  name: string;
  isDefault: boolean;
  defaultFor: string | null;
  openOffers: number;
  offers: number;
  leadMagnets: number;
  corrections: number;
  campaigns: number;
  updatedAt: string;
}

export interface SetterEditorView {
  id: string;
  name: string;
  autonomy: "approve" | "auto";
  isDefault: boolean;
  instagramAccountId: string | null;
  profile: SetterProfile;
  enabledResourceIds: string[];
  resources: ResourceView[];
  accounts: { id: string; username: string }[];
  campaigns: { id: string; name: string; setterId: string | null; setterName: string | null }[];
  otherSetters: { id: string; name: string }[];
  /** Follow-up sequences (lib/os/sequences), defaults filled in. */
  sequences: SequenceSet;
}

type ResourceRow = Awaited<ReturnType<typeof prisma.resource.findMany>>[number] & { _count?: { setters: number } };

function resourceView(r: ResourceRow): ResourceView {
  return {
    id: r.id,
    slug: r.slug,
    kind: r.kind === "setter" ? "setter" : "resource",
    name: r.name,
    link: r.link,
    keyword: r.keyword,
    status: r.status,
    description: r.description,
    setterCount: r._count?.setters ?? 0,
  };
}

export async function listResources(workspaceId: string): Promise<ResourceView[]> {
  const rows = await prisma.resource.findMany({
    where: { workspaceId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { setters: true } } },
  });
  return rows.map(resourceView);
}

export async function listSetterCards(workspaceId: string): Promise<SetterCard[]> {
  const [setters, accounts] = await Promise.all([
    prisma.setter.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { resources: true, campaigns: true } } },
    }),
    prisma.instagramAccount.findMany({ where: { workspaceId }, select: { id: true, username: true } }),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  return setters.map((s) => {
    const p = profileFromRow(s);
    const acc = accounts.find((a) => a.id === s.instagramAccountId);
    return {
      id: s.id,
      name: s.name,
      isDefault: s.isDefault,
      defaultFor: s.isDefault ? (acc ? `@${acc.username}` : "this workspace") : null,
      openOffers: p.offers.filter((o) => offerIsOpen(o, today)).length,
      offers: p.offers.length,
      leadMagnets: s._count.resources,
      corrections: p.voiceCorrections.length,
      campaigns: s._count.campaigns,
      updatedAt: s.updatedAt.toISOString(),
    };
  });
}

export async function loadSetterEditor(workspaceId: string, setterId: string): Promise<SetterEditorView | null> {
  const s = await prisma.setter.findFirst({ where: { id: setterId, workspaceId }, include: { resources: { select: { resourceId: true } } } });
  if (!s) return null;
  const [resources, accounts, automations, maps, setters, sequenceRows] = await Promise.all([
    listResources(workspaceId),
    prisma.instagramAccount.findMany({ where: { workspaceId }, select: { id: true, username: true }, orderBy: { connectedAt: "asc" } }),
    prisma.automation.findMany({ where: { workspaceId }, select: { id: true, name: true }, orderBy: { createdAt: "desc" } }),
    prisma.campaignSetter.findMany({ where: { workspaceId }, select: { automationId: true, setterId: true } }),
    prisma.setter.findMany({ where: { workspaceId }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
    prisma.followupSequence.findMany({ where: { setterId, workspaceId } }),
  ]);
  const nameOf = new Map(setters.map((x) => [x.id, x.name]));
  return {
    id: s.id,
    name: s.name,
    autonomy: s.autonomy === "AUTO" ? "auto" : "approve",
    isDefault: s.isDefault,
    instagramAccountId: s.instagramAccountId,
    profile: profileFromRow(s),
    enabledResourceIds: s.resources.map((r) => r.resourceId),
    resources,
    accounts,
    campaigns: automations.map((a) => {
      const m = maps.find((x) => x.automationId === a.id);
      return { id: a.id, name: a.name, setterId: m?.setterId ?? null, setterName: m ? (nameOf.get(m.setterId) ?? null) : null };
    }),
    otherSetters: setters.filter((x) => x.id !== s.id),
    sequences: resolveSequenceSet(sequenceRows),
  };
}
