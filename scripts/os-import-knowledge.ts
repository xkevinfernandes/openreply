// One-time import of the bundled knowledge (lib/os/setter/knowledge/<client>/:
// offer.md, offers.md, setters/default/*, memory/voice-corrections.md,
// resources.json) into a Setter + Resources for one workspace.
//
//   DATABASE_URL=… npx tsx scripts/os-import-knowledge.ts --workspace <id> [--client claudepreneur] [--overwrite]
//   (--workspace defaults to the only workspace when there is exactly one)
//
// Resources upsert by slug; the setter is created once (--overwrite replaces it).

import { prisma } from "@/lib/db/client";
import { importFromFiles } from "@/lib/os/setter/setters";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  let workspaceId = arg("workspace");
  if (!workspaceId) {
    const all = await prisma.workspace.findMany({ select: { id: true, name: true } });
    if (all.length !== 1) {
      console.error(`Pass --workspace <id>. Workspaces: ${all.map((w) => `${w.id} (${w.name})`).join(", ") || "none"}`);
      process.exit(1);
    }
    workspaceId = all[0].id;
  }
  const r = await importFromFiles(workspaceId, { clientId: arg("client"), overwrite: process.argv.includes("--overwrite") });
  console.log(`${r.created ? "Created" : "Kept"} setter ${r.setterId}; ${r.resources} resources upserted into workspace ${workspaceId}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
