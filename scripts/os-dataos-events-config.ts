// Turn the DM events sync (worker "dataos-sync") on for one workspace, or
// change its DataOS URL / ingest key. The key is read from stdin, never from
// argv, and is stored encrypted (ENCRYPTION_KEY). The contact-code secret is
// made on first use and kept.
//
//   printf %s "$KEY" | npx tsx scripts/os-dataos-events-config.ts --workspace <id> --url https://<dataos host>
//   npx tsx scripts/os-dataos-events-config.ts --workspace <id> --off

import { prisma } from "@/lib/db/client";
import { DM_EVENTS_PROVIDER } from "@/lib/os/dataos/dm-events";
import { writeDmEventsConfig } from "@/lib/os/dataos/dm-events-db";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

async function stdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function main() {
  const workspaceId = flag("--workspace");
  if (!workspaceId) throw new Error("--workspace <id> is needed");
  if (args.includes("--off")) {
    await prisma.osIntegration.updateMany({ where: { workspaceId, provider: DM_EVENTS_PROVIDER }, data: { enabled: false } });
    console.log(`dataos-sync off for ${workspaceId}`);
    return;
  }
  const url = flag("--url");
  if (!url) throw new Error("--url <DataOS base URL> is needed");
  await writeDmEventsConfig(workspaceId, { baseUrl: url, ingestKey: await stdin() });
  console.log(`dataos-sync on for ${workspaceId} → ${url} (first send on the worker's next 10-minute tick)`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
