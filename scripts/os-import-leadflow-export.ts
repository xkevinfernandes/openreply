// Step 1 of the Lead Flow import: turn a Convex snapshot (read-only) plus a
// live read of Zernio into one JSON file the import can run against anywhere.
//
//   (in Lead Flow)  npx convex export --path /tmp/lf.zip
//   npx tsx scripts/os-import-leadflow-export.ts --snapshot /tmp/lf.zip \
//     --out "…/DM Setter/operations/dms/leadflow-export-<date>.json" \
//     [--zernio-env "…/DM Setter/.env.local"]
//
// Only people with something beyond story-viewer data are written (spec item
// 22). Without --zernio-env the conversation map is Lead Flow's own copy.
// Reads ZERNIO_API_KEY / ZERNIO_ACCOUNT_ID / ZERNIO_PROFILE_ID from that file;
// the key is never printed or written.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type ExportConversation,
  type LeadFlowExport,
  type LeadFlowPerson,
  type ZernioTagged,
  CONTROL_TAGS,
  isCandidate,
} from "@/lib/os/import/leadflow";
import { arg } from "@/lib/os/import/target";

type Doc = Record<string, unknown> & { _id: string; _creationTime: number };

function readTable(dir: string, table: string): Doc[] {
  const f = path.join(dir, table, "documents.jsonl");
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Doc);
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const PIPELINE = new Set([
  "first_dm", "reply", "offer", "booked", "showed", "no_show", "pitched", "won", "lost", "reopened", "void",
]);

function readEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

async function zernio(envFile: string) {
  const env = readEnv(envFile);
  const key = env.ZERNIO_API_KEY;
  const account = env.ZERNIO_ACCOUNT_ID;
  if (!key || !account) throw new Error(`ZERNIO_API_KEY / ZERNIO_ACCOUNT_ID missing from ${envFile}`);
  const get = async (endpoint: string, params: Record<string, string>) => {
    const url = `https://zernio.com/api/v1/${endpoint}?${new URLSearchParams(params)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`Zernio GET /${endpoint} -> ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  };

  const conversations: ExportConversation[] = [];
  let cursor: string | undefined;
  let accountUsername: string | undefined;
  for (let page = 0; page < 200; page++) {
    const data = await get("inbox/conversations", { accountId: account, limit: "50", ...(cursor ? { cursor } : {}) });
    for (const c of (data.data as Record<string, unknown>[]) ?? []) {
      accountUsername ??= str(c.accountUsername);
      conversations.push({
        conversationId: String(c.id),
        participantId: str(c.participantId) ?? null,
        username: str(c.participantUsername) ?? str(c.participantName) ?? "",
        name: str(c.participantName),
        updatedTime: str(c.updatedTime),
      });
    }
    const pg = (data.pagination as { nextCursor?: string; hasMore?: boolean }) ?? {};
    cursor = pg.nextCursor;
    if (!pg.hasMore || !cursor) break;
  }

  const tagged: ZernioTagged[] = [];
  if (env.ZERNIO_PROFILE_ID) {
    for (let skip = 0; skip < 20000; ) {
      const data = await get("contacts", {
        profileId: env.ZERNIO_PROFILE_ID,
        tags: CONTROL_TAGS.join(","),
        limit: "100",
        skip: String(skip),
      });
      const page = (data.contacts as Record<string, unknown>[]) ?? [];
      for (const c of page) {
        const id = str(c.platformIdentifier);
        if (c.platform === "instagram" && id) {
          tagged.push({ participantId: id, username: str(c.name), tags: (c.tags as string[]) ?? [] });
        }
      }
      skip += page.length;
      if (!page.length || !(data.pagination as { hasMore?: boolean })?.hasMore) break;
    }
  } else {
    console.warn("ZERNIO_PROFILE_ID missing: skipping the client/friend/agent_paused tag pull.");
  }
  return { conversations, tagged, accountUsername };
}

async function main() {
  const snapshot = arg("snapshot");
  const out = arg("out");
  if (!snapshot || !out) {
    console.error("Usage: --snapshot <convex export .zip or unzipped dir> --out <file.json> [--zernio-env <.env.local>]");
    process.exit(1);
  }
  let dir = snapshot;
  if (snapshot.endsWith(".zip")) {
    dir = mkdtempSync(path.join(tmpdir(), "lf-snap-"));
    execFileSync("unzip", ["-q", "-o", snapshot, "-d", dir]);
  }

  const people = readTable(dir, "people");
  const stats = new Map(readTable(dir, "personStats").map((s) => [String(s.personId), s]));
  const touchesBy = new Map<string, LeadFlowPerson["touches"]>();
  for (const t of readTable(dir, "touches")) {
    if (!PIPELINE.has(String(t.type))) continue;
    const pid = String(t.personId);
    touchesBy.set(pid, [
      ...(touchesBy.get(pid) ?? []),
      { id: t._id, type: String(t.type), at: Number(t.at), loggedBy: str(t.loggedBy), voids: str(t.voids) },
    ]);
  }

  const all: LeadFlowPerson[] = people.map((p) => ({
    id: p._id,
    handle: String(p.handle),
    fullName: str(p.fullName),
    igPk: str(p.igPk),
    email: str(p.email),
    tags: Array.isArray(p.tags) ? (p.tags as string[]) : undefined,
    notes: str(p.notes),
    type: str(p.type),
    verdict: str(p.verdict),
    verdictReason: str(p.verdictReason),
    crm: p.crm && typeof p.crm === "object" ? (p.crm as Record<string, unknown>) : undefined,
    zernioConversationId: str(p.zernioConversationId),
    zernioParticipantId: str(p.zernioParticipantId),
    cachedStage: str(stats.get(p._id)?.stage),
    touches: touchesBy.get(p._id) ?? [],
    createdAt: Math.round(p._creationTime),
  }));
  const keep = all.filter(isCandidate);

  const convs = new Map<string, ExportConversation>();
  for (const c of readTable(dir, "zernioConversations")) {
    convs.set(String(c.conversationId), {
      conversationId: String(c.conversationId),
      participantId: str(c.participantId) ?? null,
      username: String(c.username ?? ""),
      name: str(c.name),
      updatedTime: str(c.updatedTime),
    });
  }
  let tagged: ZernioTagged[] = [];
  let zernioAccount: string | undefined;
  const envFile = arg("zernio-env");
  if (envFile) {
    const z = await zernio(envFile);
    const before = convs.size;
    for (const c of z.conversations) convs.set(c.conversationId, { ...convs.get(c.conversationId), ...c });
    tagged = z.tagged;
    zernioAccount = z.accountUsername;
    console.log(`Zernio: ${z.conversations.length} conversations (${convs.size - before} not in Lead Flow), ${tagged.length} tagged contacts.`);
  }

  const file: LeadFlowExport = {
    version: 1,
    exportedAt: new Date().toISOString(),
    source: { leadflowDeployment: process.env.CONVEX_DEPLOYMENT, zernioAccount },
    people: keep,
    conversations: [...convs.values()],
    zernioTags: tagged,
    skippedStoryViewers: all.length - keep.length,
  };
  writeFileSync(out, JSON.stringify(file, null, 1));
  console.log(
    `Wrote ${out}: ${keep.length} people (of ${all.length}; ${file.skippedStoryViewers} story-viewer only), ${file.conversations.length} conversations.`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
