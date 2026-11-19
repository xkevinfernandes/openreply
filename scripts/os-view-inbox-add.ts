// Add (or re-key) a view-only inbox: a client's DMs Kevin can read at
// /os/view, never act on (lib/os/view-inbox.ts). The key comes on stdin, never
// argv, and is stored encrypted (ENCRYPTION_KEY). Registers no webhook, makes
// no ZernioConnection or InstagramAccount row, switches nothing on.
//
//   printf %s "$KEY" | npx tsx scripts/os-view-inbox-add.ts --workspace <id> --account <zernio account id> --label "Luke (view only)"

import { prisma } from "@/lib/db/client";
import { encryptToken } from "@/lib/meta/oauth";
import { addViewInbox } from "@/lib/os/view-inbox";

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
  const zernioAccountId = flag("--account");
  const label = flag("--label");
  if (!workspaceId || !zernioAccountId || !label) throw new Error("--workspace, --account and --label are needed");
  const { id, username } = await addViewInbox(
    { workspaceId, zernioAccountId, label, apiKey: await stdin() },
    { db: prisma as unknown as Parameters<typeof addViewInbox>[1]["db"], encrypt: encryptToken },
  );
  console.log(`View-only inbox ${id} for @${username}: open /os/view/${id}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
