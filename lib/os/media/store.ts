// MessageMedia rows in Postgres.

import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import type { MediaRow, MediaStore } from "@/lib/os/media/enrich";

type DbRow = Awaited<ReturnType<typeof prisma.messageMedia.findMany>>[number];

export function fromDb(r: DbRow): MediaRow {
  return {
    workspaceId: r.workspaceId,
    contactId: r.contactId,
    conversationId: r.conversationId,
    messageId: r.messageId,
    direction: r.direction,
    kind: r.kind as MediaRow["kind"],
    sourceUrl: r.sourceUrl,
    status: r.status as MediaRow["status"],
    transcript: r.transcript,
    description: r.description,
    caption: r.caption,
    story: (r.story as MediaRow["story"]) ?? null,
    provider: r.provider,
    error: r.error,
    attempts: r.attempts,
    updatedAt: r.updatedAt,
  };
}

export const dbMediaStore: MediaStore = {
  async get(workspaceId, messageIds) {
    if (!messageIds.length) return new Map();
    const rows = await prisma.messageMedia.findMany({ where: { workspaceId, messageId: { in: messageIds } } });
    return new Map(rows.map((r) => [r.messageId, fromDb(r)]));
  },
  async save(row) {
    const data = {
      workspaceId: row.workspaceId,
      contactId: row.contactId,
      conversationId: row.conversationId,
      direction: row.direction,
      kind: row.kind,
      sourceUrl: row.sourceUrl,
      status: row.status,
      transcript: row.transcript,
      description: row.description,
      caption: row.caption,
      story: (row.story ?? undefined) as Prisma.InputJsonValue | undefined,
      provider: row.provider,
      error: row.error,
      attempts: row.attempts,
    };
    await prisma.messageMedia.upsert({ where: { messageId: row.messageId }, create: { messageId: row.messageId, ...data }, update: data });
  },
  async modelCallsSince(workspaceId, since) {
    const r = await prisma.messageMedia.aggregate({
      where: { workspaceId, kind: { in: ["voice", "image"] }, updatedAt: { gte: since }, attempts: { gt: 0 } },
      _sum: { attempts: true },
    });
    return r._sum.attempts ?? 0;
  },
};
