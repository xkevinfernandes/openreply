// One-time Lead Flow → Contact import (spec item 22), from the file
// scripts/os-import-leadflow-export.ts wrote. Dry-run by default.
//
//   DATABASE_URL=… npx tsx scripts/os-import-leadflow.ts --file leadflow-export.json \
//     [--workspace <id>] [--instagram-account <id|username>] [--apply] [--verbose]
//
// Idempotent: contacts upsert on (workspace, IG account, participant id); a
// re-run only fills gaps and never overwrites a kind or stage changed in the
// DM OS since the last import (lib/os/import/leadflow.ts mergeContact).

import { readFileSync } from "node:fs";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import {
  type ExistingContact,
  type ImportedMeta,
  type Incoming,
  type LeadFlowExport,
  indexConversations,
  isCandidate,
  leadFlowNote,
  mapKind,
  mapStage,
  mergeContact,
  personStage,
  resolveIdentity,
  stageTags,
  uniq,
  zernioTagEffects,
} from "@/lib/os/import/leadflow";
import { Tally, arg, flag, resolveTarget } from "@/lib/os/import/target";

const SELECT = {
  id: true, kind: true, kindSource: true, stage: true, tags: true, notes: true, email: true, username: true,
  fullName: true, zernioConversationId: true, paused: true, imported: true,
} as const;

async function main() {
  const file = arg("file");
  if (!file) throw new Error("Pass --file <leadflow-export.json>");
  const apply = flag("apply");
  const verbose = flag("verbose");
  const data = JSON.parse(readFileSync(file, "utf8")) as LeadFlowExport;
  if (data.version !== 1) throw new Error(`Unknown export version ${data.version}`);
  const target = await resolveTarget(prisma, { workspace: arg("workspace"), instagramAccount: arg("instagram-account") });
  const now = new Date();
  console.log(
    `${apply ? "APPLY" : "DRY RUN"}: ${data.people.length} Lead Flow people (exported ${data.exportedAt}) → workspace ${target.workspaceId} (${target.workspaceName}), @${target.instagramUsername}`,
  );
  if (data.source.zernioAccount && data.source.zernioAccount.toLowerCase() !== target.instagramUsername.toLowerCase()) {
    console.warn(`WARNING: the export's Zernio account is @${data.source.zernioAccount}, the target is @${target.instagramUsername}.`);
  }

  const { byConversation, byHandle } = indexConversations(data.conversations);
  const tagsByUser = new Map(data.zernioTags.map((z) => [z.participantId, z]));
  const byParticipant = new Map(data.conversations.filter((c) => c.participantId).map((c) => [c.participantId!, c]));
  const t = new Tally();
  t.counts.set("story viewers skipped", data.skippedStoryViewers);

  // Group by resolved id first: two Lead Flow rows can point at one person.
  const incoming = new Map<string, Incoming[]>();
  for (const p of data.people) {
    if (!isCandidate(p)) {
      t.add("story viewers skipped");
      continue;
    }
    const id = resolveIdentity(p, byConversation, byHandle);
    const lfStage = personStage(p);
    if (!id.igUserId) {
      const why = lfStage ? `in pipeline (${lfStage})` : p.type ? `type ${p.type}` : "other";
      t.add("unmatched (no DM thread)", `@${p.handle}: ${why}`);
      continue;
    }
    t.add(`matched by ${id.via}`);
    const fx = zernioTagEffects(tagsByUser.get(id.igUserId)?.tags ?? []);
    const conv = id.conversationId ? byConversation.get(id.conversationId) : byParticipant.get(id.igUserId);
    const inc: Incoming = {
      source: "leadflow",
      sourceId: p.id,
      kind: fx.kind ?? mapKind(p),
      stage: fx.stage ?? mapStage(lfStage),
      tags: uniq([...(p.tags ?? []), ...stageTags(lfStage), ...(tagsByUser.get(id.igUserId)?.tags ?? [])]),
      note: leadFlowNote(p),
      email: p.email ?? null,
      username: p.handle,
      fullName: p.fullName ?? conv?.name ?? null,
      zernioConversationId: id.conversationId ?? conv?.conversationId ?? null,
      paused: fx.paused,
    };
    if (incoming.has(id.igUserId)) t.add("duplicates (merged)", `@${p.handle} → ${id.igUserId}`);
    incoming.set(id.igUserId, [...(incoming.get(id.igUserId) ?? []), inc]);
  }
  // Zernio control tags on people Lead Flow never had.
  for (const z of data.zernioTags) {
    if (incoming.has(z.participantId)) continue;
    const fx = zernioTagEffects(z.tags);
    const conv = byParticipant.get(z.participantId);
    t.add("zernio-tag only");
    incoming.set(z.participantId, [
      {
        source: "leadflow",
        sourceId: `zernio:${z.participantId}`,
        kind: fx.kind ?? null,
        stage: fx.stage ?? null,
        tags: z.tags,
        username: z.username ?? conv?.username ?? null,
        fullName: conv?.name ?? null,
        zernioConversationId: conv?.conversationId ?? null,
        paused: fx.paused,
      },
    ]);
  }

  for (const [igUserId, incs] of incoming) {
    const key = {
      workspaceId: target.workspaceId,
      instagramAccountId: target.instagramAccountId,
      igUserId,
    };
    const row = await prisma.contact.findUnique({ where: { workspaceId_instagramAccountId_igUserId: key }, select: SELECT });
    let cur: ExistingContact | null = row ? { ...row, imported: (row.imported as ImportedMeta | null) ?? null } : null;
    const created = cur === null;
    const changed = new Set<string>();
    let patch: Record<string, unknown> = {};
    for (const inc of incs) {
      const m = mergeContact(cur, inc, now);
      m.conflicts.forEach((c) => t.add("conflicts (kept DM OS value)", `@${inc.username}: ${c}`));
      m.changed.forEach((c) => changed.add(c));
      patch = { ...patch, ...m.data };
      cur = {
        kind: m.data.kind ?? cur?.kind ?? "UNSORTED",
        kindSource: m.data.kindSource ?? cur?.kindSource ?? null,
        stage: m.data.stage ?? cur?.stage ?? "NEW",
        tags: m.data.tags ?? cur?.tags ?? [],
        notes: m.data.notes ?? cur?.notes ?? null,
        email: m.data.email ?? cur?.email ?? null,
        username: m.data.username ?? cur?.username ?? null,
        fullName: m.data.fullName ?? cur?.fullName ?? null,
        zernioConversationId: m.data.zernioConversationId ?? cur?.zernioConversationId ?? null,
        paused: m.data.paused ?? cur?.paused ?? false,
        imported: m.data.imported,
      };
    }
    const label = `@${incs[0].username ?? igUserId}`;
    if (created) {
      t.add("created", verbose ? `${label} ${cur!.kind}/${cur!.stage}` : undefined);
      t.add(`created as ${cur!.kind}`);
      t.add(`created at ${cur!.stage}`);
      if (apply) {
        await prisma.contact.create({
          data: {
            ...key,
            ...(patch as Prisma.ContactUncheckedCreateInput),
            imported: patch.imported as Prisma.InputJsonValue,
          },
        });
      }
    } else if (changed.size) {
      t.add("updated", `${label}: ${[...changed].join(", ")}`);
      if (apply) {
        await prisma.contact.update({
          where: { id: row!.id },
          data: { ...(patch as Prisma.ContactUncheckedUpdateInput), imported: patch.imported as Prisma.InputJsonValue },
        });
      }
    } else {
      t.add("unchanged");
    }
  }

  t.print(apply ? "Applied:" : "Would do (dry run; --apply to write):", verbose);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
