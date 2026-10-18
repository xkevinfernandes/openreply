// One-time import of J's operations/dms/contacts.json into Contact +
// SetterState (spec item 23). Dry-run by default.
//
//   DATABASE_URL=… npx tsx scripts/os-import-setter-state.ts --file contacts.json \
//     [--leadflow-export leadflow-export.json] [--workspace <id>] \
//     [--instagram-account <id|username>] [--apply] [--verbose]
//
// contacts.json is keyed by Zernio conversation id. The participant id
// (Contact.igUserId) comes from an existing Contact with that thread, else
// the export file's conversation map. Run the Lead Flow import first.
// Idempotent: a stored SetterState that J has moved on since the last import
// is kept (lib/os/import/setter-state.ts decideState).

import { readFileSync } from "node:fs";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import {
  type ExistingContact,
  type ImportedMeta,
  type LeadFlowExport,
  indexConversations,
  mergeContact,
  normHandle,
} from "@/lib/os/import/leadflow";
import { type ContactsFile, cleanRecord, contactFieldsFor, decideState, nextAction } from "@/lib/os/import/setter-state";
import { Tally, arg, flag, resolveTarget } from "@/lib/os/import/target";

const SELECT = {
  id: true, kind: true, kindSource: true, stage: true, tags: true, notes: true, email: true, username: true,
  fullName: true, zernioConversationId: true, paused: true, imported: true, entryPath: true, setterStage: true,
  igUserId: true,
} as const;

async function main() {
  const file = arg("file");
  if (!file) throw new Error("Pass --file <contacts.json>");
  const apply = flag("apply");
  const verbose = flag("verbose");
  const cf = JSON.parse(readFileSync(file, "utf8")) as ContactsFile;
  const records = Object.entries(cf.contacts ?? {});
  const lfFile = arg("leadflow-export");
  const lf = lfFile ? (JSON.parse(readFileSync(lfFile, "utf8")) as LeadFlowExport) : null;
  const { byConversation, byHandle } = indexConversations(lf?.conversations ?? []);
  const target = await resolveTarget(prisma, { workspace: arg("workspace"), instagramAccount: arg("instagram-account") });
  console.log(
    `${apply ? "APPLY" : "DRY RUN"}: ${records.length} J records → workspace ${target.workspaceId} (${target.workspaceName}), @${target.instagramUsername}`,
  );
  const scope = { workspaceId: target.workspaceId, instagramAccountId: target.instagramAccountId };
  const t = new Tally();

  for (const [cid, raw] of records) {
    const rec = cleanRecord(raw);
    const label = `@${rec.handle || cid}`;
    // identity
    let row = await prisma.contact.findFirst({ where: { ...scope, zernioConversationId: cid }, select: SELECT });
    let igUserId = row?.igUserId ?? null;
    if (row) t.add("matched by thread (existing contact)");
    if (!igUserId) {
      const c = byConversation.get(cid);
      if (c?.participantId) {
        igUserId = c.participantId;
        t.add("matched by export conversation");
      } else {
        const hits = (byHandle.get(normHandle(rec.handle)) ?? []).filter((x) => x.participantId);
        if (hits.length === 1) {
          igUserId = hits[0].participantId;
          t.add("matched by handle");
        }
      }
    }
    if (!igUserId) {
      t.add("unmatched", `${label} (${cid}, state ${rec.state})`);
      continue;
    }
    row ??= await prisma.contact.findUnique({
      where: { workspaceId_instagramAccountId_igUserId: { ...scope, igUserId } },
      select: SELECT,
    });
    if (row?.zernioConversationId && row.zernioConversationId !== cid) {
      t.add("conflicts (kept DM OS value)", `${label}: contact has thread ${row.zernioConversationId}, J has ${cid}`);
    }

    const f = contactFieldsFor(rec);
    const now = new Date(); // per record: the stamp must not predate this record's SetterState write
    const existing: ExistingContact | null = row ? { ...row, imported: (row.imported as ImportedMeta | null) ?? null } : null;
    const m = mergeContact(
      existing,
      {
        source: "setter",
        sourceId: cid,
        kind: f.kind,
        stage: f.stage,
        tags: f.tags,
        email: rec.email ?? null,
        username: rec.handle || null,
        fullName: rec.name || null,
        zernioConversationId: cid,
        paused: f.paused,
      },
      now,
    );
    m.conflicts.forEach((c) => t.add("conflicts (kept DM OS value)", `${label}: ${c}`));
    const extra: Record<string, string> = {};
    if (f.entryPath && !row?.entryPath) extra.entryPath = f.entryPath;
    if (rec.stage && !row?.setterStage) extra.setterStage = rec.stage;
    const changed = [...m.changed, ...Object.keys(extra)];

    // setter state
    const st = row ? await prisma.setterState.findUnique({ where: { contactId: row.id } }) : null;
    const decision = decideState(st, rec, existing?.imported?.setter?.at);
    t.add(`state ${decision}`, decision === "kept-live" ? `${label}: J has moved on since the import` : undefined);

    const contactData = { ...m.data, ...extra, imported: m.data.imported as Prisma.InputJsonValue };
    if (!row) t.add("contact created", verbose ? `${label} ${m.data.kind ?? "UNSORTED"} (${rec.state})` : undefined);
    else if (changed.length) t.add("contact updated", `${label}: ${changed.join(", ")}`);
    else t.add("contact unchanged");
    if (!apply) continue;

    const stateData = {
      workspaceId: target.workspaceId,
      state: rec.state,
      record: rec as unknown as Prisma.InputJsonValue,
      ...nextAction(rec),
    };
    await prisma.$transaction(async (tx) => {
      const contact = row
        ? changed.length || decision === "create" || decision === "update"
          ? await tx.contact.update({ where: { id: row.id }, data: contactData as Prisma.ContactUncheckedUpdateInput })
          : row
        : await tx.contact.create({
            data: { ...scope, igUserId, ...(contactData as Omit<Prisma.ContactUncheckedCreateInput, "workspaceId" | "instagramAccountId" | "igUserId">) },
          });
      if (decision === "create") await tx.setterState.create({ data: { contactId: contact.id, ...stateData } });
      else if (decision === "update") await tx.setterState.update({ where: { contactId: contact.id }, data: stateData });
    });
  }

  t.print(apply ? "Applied:" : "Would do (dry run; --apply to write):", verbose);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
