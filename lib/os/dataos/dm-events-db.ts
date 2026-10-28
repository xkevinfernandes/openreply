// The Postgres side of the DM events sync (lib/os/dataos/dm-events.ts), and
// its config: one OsIntegration row per workspace, provider "dataos_events".
//   settings    {baseUrl, cursor: {run, skip}}           not secret
//   credentials encrypted (ENCRYPTION_KEY, encryptToken) JSON {ingestKey, contactSecret}
// No row, a disabled row, or a missing field = off for that workspace.

import { randomBytes } from "node:crypto";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { decryptToken, encryptToken } from "@/lib/meta/oauth";
import { normaliseBase } from "@/lib/os/dataos/http";
import { DM_EVENTS_PROVIDER, type CursorPos, type DmEventsConfig, type DmEventsCursor, type DmEventsDb } from "@/lib/os/dataos/dm-events";

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function secretsOf(credentials: string | null): { ingestKey: string; contactSecret: string } | null {
  if (!credentials) return null;
  try {
    const c = obj(JSON.parse(decryptToken(credentials)));
    return typeof c.ingestKey === "string" && c.ingestKey && typeof c.contactSecret === "string" && c.contactSecret ? { ingestKey: c.ingestKey, contactSecret: c.contactSecret } : null;
  } catch {
    return null;
  }
}

/** Rows strictly after the cursor (at, then id), at ≤ until. */
function after(c: CursorPos | null, until: Date) {
  const at = c ? new Date(c.at) : null;
  return {
    at: { lte: until },
    ...(c && at ? { OR: [{ at: { gt: at } }, { at, id: { gt: c.id } }] } : {}),
  };
}

export const dbDmEvents: DmEventsDb = {
  async configs() {
    const rows = await prisma.osIntegration.findMany({ where: { provider: DM_EVENTS_PROVIDER, enabled: true } });
    const out: DmEventsConfig[] = [];
    for (const r of rows) {
      const s = obj(r.settings);
      const secrets = secretsOf(r.credentials);
      if (typeof s.baseUrl !== "string" || !s.baseUrl || !secrets) continue;
      out.push({ workspaceId: r.workspaceId, baseUrl: s.baseUrl, ...secrets, cursor: obj(s.cursor) as DmEventsCursor });
    }
    return out;
  },
  async runEvents(workspaceId, c, until, limit) {
    return prisma.workflowRunEvent.findMany({
      where: {
        workspaceId,
        ...after(c, until),
        AND: [
          {
            OR: [
              { kind: { in: ["enter", "released", "end", "failed", "link_clicked"] } },
              { kind: "leave", port: { startsWith: "button:" } },
              { kind: "replied", data: { path: ["saved"], equals: true } },
            ],
          },
        ],
      },
      orderBy: [{ at: "asc" }, { id: "asc" }],
      take: limit,
      select: { id: true, at: true, kind: true, port: true, nodeId: true, data: true, runId: true, workflowId: true, versionId: true },
    });
  },
  async skips(workspaceId, c, until, limit) {
    return prisma.osEvent.findMany({
      where: { workspaceId, kind: "workflow_skipped", ...after(c, until) },
      orderBy: [{ at: "asc" }, { id: "asc" }],
      take: limit,
      select: { id: true, at: true, contactId: true, data: true },
    });
  },
  async runs(ids) {
    if (!ids.length) return [];
    // Only the contact id and the trigger's post ids are used (the trigger's text never leaves).
    return prisma.workflowRun.findMany({ where: { id: { in: ids } }, select: { id: true, contactId: true, trigger: true } });
  },
  async versions(ids) {
    if (!ids.length) return [];
    return prisma.workflowVersion.findMany({ where: { id: { in: ids } }, select: { id: true, workflowId: true, graph: true, keywords: true } });
  },
  async workflows(ids) {
    if (!ids.length) return [];
    return prisma.workflow.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, currentVersionId: true } });
  },
  async saveCursor(workspaceId, cursor, error) {
    const row = await prisma.osIntegration.findUnique({ where: { workspaceId_provider: { workspaceId, provider: DM_EVENTS_PROVIDER } }, select: { settings: true } });
    if (!row) return;
    await prisma.osIntegration.update({
      where: { workspaceId_provider: { workspaceId, provider: DM_EVENTS_PROVIDER } },
      data: { settings: { ...obj(row.settings), cursor } as unknown as Prisma.InputJsonValue, lastError: error, lastTestedAt: new Date() },
    });
  },
};

/**
 * Turn the sync on for a workspace (or change its URL / key). The contact
 * secret is made once and kept: changing it would change every contact_code.
 * The cursor is kept too.
 */
export async function writeDmEventsConfig(workspaceId: string, input: { baseUrl: string; ingestKey: string }): Promise<void> {
  const baseUrl = normaliseBase(input.baseUrl);
  const ingestKey = input.ingestKey.trim();
  if (!ingestKey) throw new Error("An ingest key is needed.");
  const where = { workspaceId_provider: { workspaceId, provider: DM_EVENTS_PROVIDER } };
  const existing = await prisma.osIntegration.findUnique({ where, select: { credentials: true, settings: true } });
  const contactSecret = secretsOf(existing?.credentials ?? null)?.contactSecret ?? randomBytes(32).toString("hex");
  const credentials = encryptToken(JSON.stringify({ ingestKey, contactSecret }));
  const settings = { ...obj(existing?.settings), baseUrl } as Prisma.InputJsonValue;
  await prisma.osIntegration.upsert({
    where,
    create: { workspaceId, provider: DM_EVENTS_PROVIDER, credentials, settings, enabled: true },
    update: { credentials, settings, enabled: true, lastError: null },
  });
}
