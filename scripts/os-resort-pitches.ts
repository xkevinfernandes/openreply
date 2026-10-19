// Re-sort pitches: move people selling to Kevin (other creators' automations,
// agencies, collab asks) out of Unsorted and Sales into Pitches.
// Dry run by default; --apply writes. Kevin's own choices are never changed.
//
//   npx tsx scripts/os-resort-pitches.ts [--workspace <id>] [--apply] [--limit 200]

import { prisma } from "@/lib/db/client";
import { resortPitches } from "@/lib/os/setter/triage";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i > -1 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const limit = Number(arg("--limit") ?? 200);
  const workspaceIds = arg("--workspace") ? [arg("--workspace")!] : (await prisma.workspace.findMany({ select: { id: true } })).map((w) => w.id);
  for (const workspaceId of workspaceIds) {
    const r = await resortPitches(workspaceId, { dryRun: !apply, limit });
    console.log(`${workspaceId}: looked at ${r.looked}, ${apply ? "moved" : "would move"} ${r.moved.length}${r.errors ? `, ${r.errors} errors` : ""}`);
    for (const m of r.moved) console.log(`  @${m.username ?? m.contactId} (${m.from}) — ${m.reason}`);
  }
  if (!apply) console.log("Dry run. Pass --apply to move them.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
