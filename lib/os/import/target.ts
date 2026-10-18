// Shared bits of the one-time import scripts (scripts/os-import-*.ts):
// argument parsing and which workspace / Instagram account to write into.

import type { PrismaClient } from "@/app/generated/prisma/client";

export function arg(name: string, argv = process.argv): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

export function flag(name: string, argv = process.argv): boolean {
  return argv.includes(`--${name}`);
}

export interface Target {
  workspaceId: string;
  workspaceName: string;
  instagramAccountId: string;
  instagramUsername: string;
}

/**
 * --workspace <id> (default: the only workspace) and --instagram-account
 * <id | username | instagramId> (default: the only account in the workspace).
 */
export async function resolveTarget(
  db: PrismaClient,
  opts: { workspace?: string; instagramAccount?: string },
): Promise<Target> {
  let ws = opts.workspace ? await db.workspace.findUnique({ where: { id: opts.workspace } }) : null;
  if (!ws) {
    const all = await db.workspace.findMany({ select: { id: true, name: true } });
    if (opts.workspace || all.length !== 1) {
      throw new Error(
        `Pass --workspace <id>. Workspaces: ${all.map((w) => `${w.id} (${w.name})`).join(", ") || "none"}`,
      );
    }
    ws = await db.workspace.findUniqueOrThrow({ where: { id: all[0].id } });
  }
  const accounts = await db.instagramAccount.findMany({
    where: { workspaceId: ws.id },
    select: { id: true, username: true, instagramId: true },
  });
  const want = opts.instagramAccount?.replace(/^@/, "").toLowerCase();
  const acct = want
    ? accounts.find((a) => a.id === opts.instagramAccount || a.instagramId === want || a.username.toLowerCase() === want)
    : accounts.length === 1
      ? accounts[0]
      : undefined;
  if (!acct) {
    throw new Error(
      `Pass --instagram-account <id|username>. Accounts in ${ws.id}: ${accounts.map((a) => `${a.id} (@${a.username})`).join(", ") || "none"}`,
    );
  }
  return { workspaceId: ws.id, workspaceName: ws.name, instagramAccountId: acct.id, instagramUsername: acct.username };
}

/** Counters printed at the end of a run. */
export class Tally {
  counts = new Map<string, number>();
  lines = new Map<string, string[]>();
  add(key: string, line?: string) {
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    if (line) this.lines.set(key, [...(this.lines.get(key) ?? []), line]);
  }
  get(key: string) {
    return this.counts.get(key) ?? 0;
  }
  print(title: string, verbose: boolean) {
    console.log(`\n${title}`);
    for (const [k, n] of [...this.counts].sort()) console.log(`  ${k.padEnd(28)} ${n}`);
    for (const [k, ls] of this.lines) {
      if (!verbose && ls.length > 15) {
        console.log(`\n${k} (first 15 of ${ls.length}; --verbose for all):`);
        ls.slice(0, 15).forEach((l) => console.log(`  - ${l}`));
      } else {
        console.log(`\n${k}:`);
        ls.forEach((l) => console.log(`  - ${l}`));
      }
    }
  }
}
