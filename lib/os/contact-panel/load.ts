// The contact panel's shared head: who, stage, setter, key fields, keywords
// triggered → resource, next follow-up. Tabs load their own data
// (details.ts S3, followups.ts S5, chat S1). Owner: F.

import type { ContactKind } from "@/app/generated/prisma/enums";
import { prisma } from "@/lib/db/client";
import { nextFollowupLine } from "@/lib/os/contact-panel/followups";
import type { ContactPanelData, PanelField, PanelKeyword } from "@/lib/os/contact-panel/types";
import { columnFor, funnelColumns, type FunnelStageLike } from "@/lib/os/funnel";
import { mockContactPanel, osMockEnabled } from "@/lib/os/mock";
import { defaultSetterId } from "@/lib/os/setter/setters";

/** How many fields the panel head shows before "Details" takes over. */
export const KEY_FIELD_LIMIT = 8;

export function funnelOf(json: unknown): FunnelStageLike[] {
  return Array.isArray(json)
    ? json
        .filter((s): s is { key?: unknown; label?: unknown } => Boolean(s) && typeof s === "object")
        .filter((s) => typeof s.key === "string" || typeof s.label === "string")
        .map((s) => ({ key: String(s.key ?? s.label), label: String(s.label ?? s.key) }))
    : [];
}

/** Key fields: the setter's fields first, then the rest, values where known. */
export function keyFields(
  fields: { id: string; key: string; label: string; sortOrder: number }[],
  values: Map<string, { value: string; source: string }>,
  setterFieldIds: Set<string>,
  builtins: { first_name?: string | null; email?: string | null }
): PanelField[] {
  const ordered = [...fields].sort((a, b) => Number(setterFieldIds.has(b.id)) - Number(setterFieldIds.has(a.id)) || a.sortOrder - b.sortOrder);
  return ordered.slice(0, KEY_FIELD_LIMIT).map((f) => {
    const v = values.get(f.id);
    const builtin = f.key === "first_name" ? builtins.first_name : f.key === "email" ? builtins.email : null;
    return { key: f.key, label: f.label, value: v?.value ?? builtin ?? null, byJ: v?.source === "j" };
  });
}

export async function loadContactPanel(workspaceId: string, contactId: string): Promise<ContactPanelData | null> {
  if (osMockEnabled()) return mockContactPanel(contactId);

  const contact = await prisma.contact.findFirst({ where: { id: contactId, workspaceId } });
  if (!contact) return null;

  const setterId = contact.setterId ?? (await defaultSetterId(workspaceId, contact.instagramAccountId));
  const [setter, booking, fields, values, setterFields, logs, step] = await Promise.all([
    setterId ? prisma.setter.findFirst({ where: { id: setterId, workspaceId }, select: { id: true, name: true, funnel: true } }) : null,
    prisma.booking.findFirst({ where: { contactId, status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, select: { attendance: true } }),
    prisma.customField.findMany({ where: { workspaceId }, select: { id: true, key: true, label: true, sortOrder: true } }),
    prisma.contactFieldValue.findMany({ where: { contactId }, select: { fieldId: true, value: true, source: true } }),
    setterId ? prisma.setterField.findMany({ where: { setterId }, select: { fieldId: true } }) : [],
    prisma.dmLog.findMany({
      where: { workspaceId, instagramAccountId: contact.instagramAccountId, commenterId: contact.igUserId },
      orderBy: { createdAt: "asc" },
      select: { automationId: true, matchedKeyword: true, createdAt: true },
      take: 20,
    }),
    prisma.followupStep.findFirst({ where: { contactId, status: { in: ["QUEUED", "DRAFTED"] } }, orderBy: { dueAt: "asc" }, select: { dueAt: true, step: true, sequence: true } }),
  ]);

  const columns = funnelColumns(funnelOf(setter?.funnel));
  const automationIds = [...new Set(logs.map((l) => l.automationId))];
  const [maps, automations] = await Promise.all([
    automationIds.length ? prisma.campaignResource.findMany({ where: { automationId: { in: automationIds } }, select: { automationId: true, resourceId: true } }) : [],
    automationIds.length ? prisma.automation.findMany({ where: { id: { in: automationIds } }, select: { id: true, keywords: true } }) : [],
  ]);
  const resources = maps.length ? await prisma.resource.findMany({ where: { id: { in: maps.map((m) => m.resourceId) } }, select: { id: true, name: true } }) : [];
  const resourceName = new Map(maps.map((m) => [m.automationId, resources.find((r) => r.id === m.resourceId)?.name ?? null]));
  const keywords: PanelKeyword[] = logs.map((l) => ({
    word: (l.matchedKeyword ?? automations.find((a) => a.id === l.automationId)?.keywords[0] ?? "Comment").toUpperCase(),
    surface: "comment",
    resource: resourceName.get(l.automationId) ?? null,
    at: l.createdAt.toISOString(),
  }));
  if (contact.entryPath === "story_reply") keywords.unshift({ word: "Story reply", surface: "story_reply", resource: null, at: contact.createdAt.toISOString() });

  const label = (step?.step as { label?: string } | null)?.label ?? null;

  return {
    contactId,
    conversationId: contact.zernioConversationId,
    username: contact.username,
    fullName: contact.fullName,
    avatarUrl: contact.avatarUrl,
    kind: contact.kind as ContactKind,
    setter: setter ? { id: setter.id, name: setter.name } : null,
    stage: { column: columnFor({ stage: contact.stage, setterStage: contact.setterStage, attendance: booking?.attendance ?? null }, columns), columns },
    fields: keyFields(
      fields,
      new Map(values.map((v) => [v.fieldId, v])),
      new Set(setterFields.map((s) => s.fieldId)),
      { first_name: contact.fullName?.split(/\s+/)[0] ?? null, email: contact.email }
    ),
    keywords,
    nextFollowup: nextFollowupLine(step ? { dueAt: step.dueAt, label, sequence: step.sequence } : null),
  };
}
