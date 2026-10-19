"use server";

// Knowledge bases: every write is scoped to the signed-in workspace (a foreign
// id is "not found"), and every payload is re-validated here with the same
// coercers J reads with (lib/os/setter/kb.ts), so the editor can't store a
// shape J can't read.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Prisma } from "@/app/generated/prisma/client";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { asBusiness, asCorrections, asFunnel, asOffers, asSettings, slugify } from "@/lib/os/setter/kb";
import { sandboxReply, type SandboxReply, type SandboxTurn } from "@/lib/os/setter/sandbox";
import { dbKnowledge, importFromFiles } from "@/lib/os/setter/setters";
import { saveSetterSequence } from "@/lib/os/sequences/engine";
import { cleanSequence, isSequenceKey } from "@/lib/os/sequences/types";

const BASE = "/os/knowledge";

async function requireWorkspace() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) throw new Error("Sign in again.");
  return workspaceId;
}

async function ownSetter(workspaceId: string, setterId: string) {
  const s = await prisma.setter.findFirst({ where: { id: setterId, workspaceId } });
  if (!s) throw new Error("That knowledge base is gone. Refresh the page.");
  return s;
}

export interface ActionResult {
  error?: string;
}

async function attempt(fn: () => Promise<void>): Promise<ActionResult> {
  try {
    await fn();
    return {};
  } catch (err) {
    console.error("[OS Knowledge]", err);
    return { error: err instanceof Error ? err.message : "That didn't save. Try again." };
  }
}

const json = (v: unknown) => v as Prisma.InputJsonValue;

// ---------------------------------------------------------------- setters
export async function importKnowledge(): Promise<ActionResult> {
  const workspaceId = await requireWorkspace();
  let id: string;
  try {
    id = (await importFromFiles(workspaceId)).setterId;
  } catch (err) {
    console.error("[OS Knowledge] import failed:", err);
    return { error: err instanceof Error ? err.message : "The import failed." };
  }
  revalidatePath(BASE);
  redirect(`${BASE}/${id}`);
}

export async function createSetter(name: string, copyFromId?: string | null): Promise<ActionResult> {
  const workspaceId = await requireWorkspace();
  const clean = name.trim().slice(0, 80);
  if (!clean) return { error: "Give it a name." };
  let id: string;
  try {
    const src = copyFromId ? await ownSetter(workspaceId, copyFromId) : null;
    const hasAny = await prisma.setter.count({ where: { workspaceId } });
    const created = await prisma.setter.create({
      data: {
        workspaceId,
        name: clean,
        isDefault: hasAny === 0,
        ...(src
          ? {
              autonomy: src.autonomy,
              settings: json(src.settings),
              business: json(src.business),
              offers: json(src.offers),
              funnel: json(src.funnel),
              voice: src.voice,
              voiceExamples: src.voiceExamples,
              examples: src.examples,
              voiceCorrections: json(src.voiceCorrections),
            }
          : {}),
      },
    });
    if (src) {
      const on = await prisma.setterResource.findMany({ where: { setterId: src.id }, select: { resourceId: true } });
      if (on.length) await prisma.setterResource.createMany({ data: on.map((r) => ({ setterId: created.id, resourceId: r.resourceId })) });
    }
    id = created.id;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't create it." };
  }
  revalidatePath(BASE);
  redirect(`${BASE}/${id}`);
}

export async function deleteSetter(setterId: string): Promise<ActionResult> {
  const workspaceId = await requireWorkspace();
  try {
    await ownSetter(workspaceId, setterId);
    // Contact.setterId goes back to null (= default) via ON DELETE SET NULL.
    await prisma.setter.delete({ where: { id: setterId } });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't delete it." };
  }
  revalidatePath(BASE);
  redirect(BASE);
}

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  autonomy: z.enum(["approve", "auto"]).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  business: z.unknown().optional(),
  offers: z.unknown().optional(),
  funnel: z.unknown().optional(),
  voice: z.string().max(40_000).optional(),
  voiceExamples: z.string().max(40_000).optional(),
  examples: z.string().max(80_000).optional(),
  voiceCorrections: z.unknown().optional(),
});

export type SetterPatch = z.input<typeof PatchSchema>;

/** Save one or more sections of a knowledge base. */
export async function saveSetter(setterId: string, patch: SetterPatch): Promise<ActionResult> {
  const workspaceId = await requireWorkspace();
  const result = await attempt(async () => {
    const current = await ownSetter(workspaceId, setterId);
    const p = PatchSchema.parse(patch);
    const data: Prisma.SetterUpdateInput = {};
    if (p.name !== undefined) data.name = p.name;
    if (p.autonomy !== undefined) data.autonomy = p.autonomy === "auto" ? "AUTO" : "APPROVE";
    if (p.settings !== undefined) data.settings = json(asSettings({ ...asSettings(current.settings), ...p.settings }));
    if (p.business !== undefined) data.business = json(asBusiness(p.business));
    if (p.offers !== undefined) data.offers = json(asOffers(p.offers));
    if (p.funnel !== undefined) data.funnel = json(asFunnel(p.funnel));
    if (p.voice !== undefined) data.voice = p.voice.trim();
    if (p.voiceExamples !== undefined) data.voiceExamples = p.voiceExamples.trim();
    if (p.examples !== undefined) data.examples = p.examples.trim();
    if (p.voiceCorrections !== undefined) data.voiceCorrections = json(asCorrections(p.voiceCorrections));
    await prisma.setter.update({ where: { id: setterId }, data });
  });
  revalidatePath(BASE, "layout");
  return result;
}

export async function setLeadMagnet(setterId: string, resourceId: string, on: boolean): Promise<ActionResult> {
  const workspaceId = await requireWorkspace();
  const result = await attempt(async () => {
    await ownSetter(workspaceId, setterId);
    const r = await prisma.resource.findFirst({ where: { id: resourceId, workspaceId }, select: { id: true } });
    if (!r) throw new Error("That resource is gone. Refresh the page.");
    if (on) await prisma.setterResource.createMany({ data: [{ setterId, resourceId }], skipDuplicates: true });
    else await prisma.setterResource.deleteMany({ where: { setterId, resourceId } });
  });
  revalidatePath(BASE, "layout");
  return result;
}

/** target: an InstagramAccount id, "workspace" (no account), or null (not a default). */
export async function setDefaultFor(setterId: string, target: string | null): Promise<ActionResult> {
  const workspaceId = await requireWorkspace();
  const result = await attempt(async () => {
    await ownSetter(workspaceId, setterId);
    if (target && target !== "workspace") {
      const acc = await prisma.instagramAccount.findFirst({ where: { id: target, workspaceId }, select: { id: true } });
      if (!acc) throw new Error("That Instagram account isn't in this workspace.");
    }
    const instagramAccountId = target && target !== "workspace" ? target : null;
    await prisma.$transaction([
      // One default per account (or for the workspace).
      ...(target ? [prisma.setter.updateMany({ where: { workspaceId, instagramAccountId, isDefault: true }, data: { isDefault: false } })] : []),
      prisma.setter.update({ where: { id: setterId }, data: { instagramAccountId, isDefault: Boolean(target) } }),
    ]);
  });
  revalidatePath(BASE, "layout");
  return result;
}

/** Campaign override: people from this automation are answered by setterId (null = account default). */
export async function setCampaignSetter(automationId: string, setterId: string | null): Promise<ActionResult> {
  const workspaceId = await requireWorkspace();
  const result = await attempt(async () => {
    const auto = await prisma.automation.findFirst({ where: { id: automationId, workspaceId }, select: { id: true } });
    if (!auto) throw new Error("That campaign isn't in this workspace.");
    if (!setterId) {
      await prisma.campaignSetter.deleteMany({ where: { automationId, workspaceId } });
      return;
    }
    await ownSetter(workspaceId, setterId);
    await prisma.campaignSetter.upsert({
      where: { automationId },
      create: { workspaceId, automationId, setterId },
      update: { setterId },
    });
  });
  revalidatePath(BASE, "layout");
  return result;
}

// ---------------------------------------------------------------- resources
const ResourceSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Give it a name.").max(160),
  kind: z.enum(["resource", "setter"]),
  link: z.string().trim().max(2000),
  keyword: z.string().trim().max(80),
  status: z.enum(["ACTIVE", "TEST", "DRAFT"]),
  description: z.string().trim().max(4000),
});

export type ResourceForm = z.input<typeof ResourceSchema>;

export async function saveResource(input: ResourceForm): Promise<ActionResult & { id?: string }> {
  const workspaceId = await requireWorkspace();
  let id: string | undefined;
  const parsed = ResourceSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the fields." };
  const r = parsed.data;
  if (r.link && !/^https?:\/\//i.test(r.link)) return { error: "Links start with https://" };
  const result = await attempt(async () => {
    const fields = { name: r.name, kind: r.kind, link: r.link || null, keyword: r.keyword || null, status: r.status, description: r.description };
    if (r.id) {
      const cur = await prisma.resource.findFirst({ where: { id: r.id, workspaceId } });
      if (!cur) throw new Error("That resource is gone. Refresh the page.");
      // Keep the click-tracked button link in step when it was the same link.
      const data = (cur.data && typeof cur.data === "object" ? { ...(cur.data as Record<string, unknown>) } : {}) as Record<string, unknown>;
      const zernio = data.zernio as Record<string, unknown> | undefined;
      if (zernio && cur.link && zernio.button_url === cur.link) data.zernio = { ...zernio, button_url: fields.link ?? undefined };
      await prisma.resource.update({ where: { id: cur.id }, data: { ...fields, data: json(data) } });
      id = cur.id;
    } else {
      let slug = slugify(r.name);
      for (let i = 2; await prisma.resource.findFirst({ where: { workspaceId, slug }, select: { id: true } }); i++) slug = `${slugify(r.name)}-${i}`;
      const max = await prisma.resource.aggregate({ where: { workspaceId }, _max: { sortOrder: true } });
      id = (await prisma.resource.create({ data: { workspaceId, slug, ...fields, sortOrder: (max._max.sortOrder ?? 0) + 1 } })).id;
    }
  });
  revalidatePath(BASE, "layout");
  return { ...result, id };
}

export async function deleteResource(resourceId: string): Promise<ActionResult> {
  const workspaceId = await requireWorkspace();
  const result = await attempt(async () => {
    const r = await prisma.resource.deleteMany({ where: { id: resourceId, workspaceId } });
    if (!r.count) throw new Error("That resource is gone. Refresh the page.");
  });
  revalidatePath(BASE, "layout");
  return result;
}

// ---------------------------------------------------------------- sandbox
const TurnsSchema = z
  .array(z.object({ from: z.enum(["lead", "setter"]), text: z.string().max(4000) }))
  .max(200);

/** One J turn in the sandbox. Never touches Instagram, contacts or drafts. */
export async function runSandbox(
  setterId: string,
  turns: SandboxTurn[],
  entrySlug: string | null
): Promise<{ error?: string; reply?: SandboxReply }> {
  const workspaceId = await requireWorkspace();
  try {
    const setter = await dbKnowledge.forSetter(workspaceId, setterId);
    if (!setter) return { error: "That knowledge base is gone. Refresh the page." };
    const reply = await sandboxReply(setter, TurnsSchema.parse(turns), { entrySlug });
    return { reply };
  } catch (err) {
    console.error("[OS Sandbox]", err);
    return { error: err instanceof Error ? `J couldn't answer: ${err.message}` : "J couldn't answer. Try again." };
  }
}

// ---------------------------------------------------------------- follow-ups
/** One follow-up sequence: its switch and its steps. Switching off cancels
 *  what's queued from it; on (or an edit) re-plans who it applies to. */
export async function saveFollowupSequence(setterId: string, key: string, raw: unknown): Promise<ActionResult> {
  const workspaceId = await requireWorkspace();
  return attempt(async () => {
    await ownSetter(workspaceId, setterId);
    if (!isSequenceKey(key)) throw new Error("Unknown sequence.");
    await saveSetterSequence(workspaceId, setterId, cleanSequence(key, raw));
    revalidatePath(`${BASE}/${setterId}`);
    revalidatePath("/os/follow-ups");
  });
}
