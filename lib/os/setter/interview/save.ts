// "New setter": save the reviewed draft as a NEW setter. Never updates an
// existing one: a taken name gets " (2)", " (3)"… Lead magnets reuse a
// workspace resource with the same link or name, else are added as new rows,
// and are switched on for this setter only.

import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { slugify } from "@/lib/os/setter/kb";
import { normalizeSetterBooking } from "@/lib/os/integrations/calendar/setter-booking";
import { DOC_KEYS, isDocKey, type DocKey } from "@/lib/os/setter/knowledge/docs";
import { normalizeDocs, type SetterDraft } from "@/lib/os/setter/interview/generate";
import type { FunnelStage } from "@/lib/os/setter/profile";

export const INTERVIEW_AUTHOR = "New setter";
const MAX_DOC = 120_000;

/** "J" taken → "J (2)". Pure. */
export function freeName(name: string, taken: string[]): string {
  const base = name.trim().slice(0, 74) || "New setter";
  const lower = new Set(taken.map((t) => t.trim().toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!lower.has(`${base} (${i})`.toLowerCase())) return `${base} (${i})`;
}

function cleanFunnel(raw: unknown): FunnelStage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object")
    .map((s) => ({ key: String(s.key ?? s.label ?? "").slice(0, 60), label: String(s.label ?? s.key ?? "").slice(0, 60), guidance: String(s.guidance ?? "").slice(0, 4000) }))
    .filter((s) => s.key && s.label);
}

export interface SaveDraftResult {
  setterId: string;
  name: string;
}

export async function createSetterFromDraft(workspaceId: string, raw: SetterDraft): Promise<SaveDraftResult> {
  const docsIn: Partial<Record<DocKey, string>> = {};
  for (const [k, v] of Object.entries(raw.docs ?? {})) if (isDocKey(k) && typeof v === "string" && v.length <= MAX_DOC) docsIn[k] = v.replace(/\r\n/g, "\n");
  const bookingLink = typeof raw.bookingLink === "string" && /^https?:\/\/\S+$/i.test(raw.bookingLink) ? raw.bookingLink : null;
  // Reviewed text is kept as Kevin left it; only a missing doc gets the canonical empty one.
  const canonical = normalizeDocs({}, null);
  const docs = Object.fromEntries(DOC_KEYS.map((k) => [k, docsIn[k] ?? canonical[k]])) as Record<DocKey, string>;
  const funnel = cleanFunnel(raw.funnel);
  const magnets = (Array.isArray(raw.leadMagnets) ? raw.leadMagnets : [])
    .filter((m) => m && typeof m.name === "string" && m.name.trim())
    .slice(0, 12)
    .map((m) => ({ name: m.name.trim().slice(0, 160), link: typeof m.link === "string" && /^https?:\/\//i.test(m.link) ? m.link : null }));

  return prisma.$transaction(async (tx) => {
    const taken = (await tx.setter.findMany({ where: { workspaceId }, select: { name: true } })).map((s) => s.name);
    const name = freeName(raw.name ?? "", taken);
    const { configured: _c, ...booking } = normalizeSetterBooking({ mode: "link", link: bookingLink });
    const settings = bookingLink ? { booking } : {};
    const setter = await tx.setter.create({
      data: {
        workspaceId,
        name,
        isDefault: taken.length === 0,
        funnel: funnel as unknown as Prisma.InputJsonValue,
        settings: settings as unknown as Prisma.InputJsonValue,
      },
    });
    for (const key of DOC_KEYS) {
      await tx.setterDoc.create({
        data: { setterId: setter.id, key, body: docs[key], updatedBy: INTERVIEW_AUTHOR, revisions: { create: { body: docs[key], author: INTERVIEW_AUTHOR } } },
      });
    }
    if (magnets.length) {
      const existing = await tx.resource.findMany({ where: { workspaceId }, select: { id: true, name: true, link: true, slug: true, sortOrder: true } });
      let order = Math.max(0, ...existing.map((r) => r.sortOrder));
      const slugs = new Set(existing.map((r) => r.slug));
      const ids: string[] = [];
      for (const m of magnets) {
        const hit = existing.find((r) => (m.link && r.link === m.link) || r.name.trim().toLowerCase() === m.name.toLowerCase());
        if (hit) {
          ids.push(hit.id);
          continue;
        }
        let slug = slugify(m.name) || "resource";
        for (let i = 2; slugs.has(slug); i++) slug = `${slugify(m.name) || "resource"}-${i}`;
        slugs.add(slug);
        const r = await tx.resource.create({
          data: { workspaceId, slug, kind: "resource", name: m.name, link: m.link, status: m.link ? "ACTIVE" : "DRAFT", description: "", sortOrder: ++order },
        });
        ids.push(r.id);
      }
      await tx.setterResource.createMany({ data: [...new Set(ids)].map((resourceId) => ({ setterId: setter.id, resourceId })), skipDuplicates: true });
    }
    return { setterId: setter.id, name };
  });
}
