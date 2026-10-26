// Dev seed for a DM OS worktree DB (never production). Idempotent: run it as
// often as you like; it only creates what is missing and never overwrites
// edits (setter docs, field mappings).
//
//   DATABASE_URL=postgresql://Kevin@localhost:5432/openreply_os_<name> npx tsx scripts/os-seed-dev.ts
//
// Creates: the local user + session cookie "local-dev-session", its workspace,
// setters J (default, bundled knowledge) and Nova, 9 custom fields with
// SetterField links, resources Setter Starter (SETTER/STARTER) and Script Vault
// (SCRIPT), 4 best episodes, CampaignResource rows, the Follow-up Friday
// broadcast, OsEvents giving 118/42/26/9/4/3/1 over the last 7 days, and
// SetterDocs for J. Streams add their own sample data in lib/os/mock-<stream>.ts.

import type { CustomFieldType, Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { FOLLOW_UP_FRIDAY } from "@/lib/os/broadcasts/types";
import { OS_EVENT_KINDS, recordEvents, type OsEventInput, type OsEventKind } from "@/lib/os/events";
import { importFromFiles } from "@/lib/os/setter/setters";
import { ensureWorkspaceForUser } from "@/lib/workspace";

if (process.env.NODE_ENV === "production") {
  console.error("os-seed-dev is for local worktree databases only.");
  process.exit(1);
}

const USER = { id: "u_local", email: "local@dev.test", name: "Local dev" };
const SESSION = "local-dev-session";

/** The board's field set (InboxA / SettingsFields). */
export const SEED_FIELDS: { key: string; label: string; type: CustomFieldType; builtIn?: boolean; options?: string[] }[] = [
  { key: "first_name", label: "First name", type: "TEXT", builtIn: true },
  { key: "email", label: "Email", type: "EMAIL", builtIn: true },
  { key: "business", label: "Business", type: "TEXT" },
  { key: "monthly_revenue", label: "Revenue", type: "TEXT" },
  { key: "their_goal", label: "Goal", type: "TEXT" },
  { key: "their_challenge", label: "Blocker", type: "LONG_TEXT" },
  { key: "timezone", label: "Timezone", type: "TIMEZONE" },
  { key: "call_time", label: "Call", type: "DATE" },
  { key: "niche", label: "Niche", type: "SELECT", options: ["Coach", "Creator", "Agency", "SaaS", "Other"] },
];

const J_FIELDS = ["first_name", "email", "business", "monthly_revenue", "their_goal", "their_challenge", "timezone", "call_time"];
const NOVA_FIELDS = ["first_name", "email", "their_goal", "niche"];

/** 7-day outcome row on Home: Keyword triggers → … → Won. */
export const SEED_FUNNEL: [OsEventKind, number][] = [
  ["keyword_trigger", 118],
  ["conversation_started", 42],
  ["lead_magnet_sent", 26],
  ["offer_made", 9],
  ["call_booked", 4],
  ["showed", 3],
  ["won", 1],
];

const EPISODES = [
  { slug: "ep-claude-setter", name: "How I built a DM setter with Claude", link: "https://www.youtube.com/watch?v=dev-setter", when: "They ask how the setter works or if it's real." },
  { slug: "ep-first-10k", name: "From 0 to the first $10k with AI agents", link: "https://www.youtube.com/watch?v=dev-10k", when: "Early-stage, unsure where to start." },
  { slug: "ep-content-system", name: "The content system behind @claudepreneur", link: "https://www.youtube.com/watch?v=dev-content", when: "They're stuck on what to post." },
  { slug: "ep-dm-scripts", name: "The DM scripts that book my calls", link: "https://www.youtube.com/watch?v=dev-scripts", when: "They want to set their own DMs." },
];

async function ensureUser() {
  await prisma.user.upsert({ where: { id: USER.id }, create: USER, update: {} });
  const expires = new Date(Date.now() + 365 * 86400_000);
  await prisma.session.upsert({ where: { sessionToken: SESSION }, create: { sessionToken: SESSION, userId: USER.id, expires }, update: { expires, userId: USER.id } });
  return ensureWorkspaceForUser(USER.id, USER.email);
}

async function ensureSetters(workspaceId: string) {
  let j = await prisma.setter.findFirst({ where: { workspaceId, name: "J" } });
  if (!j) {
    const existingDefault = await prisma.setter.findFirst({ where: { workspaceId, isDefault: true } });
    if (existingDefault) {
      j = await prisma.setter.update({ where: { id: existingDefault.id }, data: { name: "J" } });
    } else {
      const r = await importFromFiles(workspaceId, { name: "J" });
      j = await prisma.setter.findUniqueOrThrow({ where: { id: r.setterId } });
    }
  }
  let nova = await prisma.setter.findFirst({ where: { workspaceId, name: "Nova" } });
  nova ??= await prisma.setter.create({
    data: {
      workspaceId,
      name: "Nova",
      isDefault: false,
      voice: "Warm, short, curious. Lowercase. One question at a time.",
      funnel: [
        { key: "open", label: "Open", guidance: "Answer what they said." },
        { key: "value", label: "Value", guidance: "Get curious about their thing." },
        { key: "qualify", label: "Qualify", guidance: "Goal, blocker, what they tried." },
        { key: "book", label: "Book", guidance: "Offer a call when it fits." },
      ],
    },
  });
  return { j, nova };
}

async function ensureFields(workspaceId: string, setters: { j: { id: string }; nova: { id: string } }) {
  const ids = new Map<string, string>();
  for (const [i, f] of SEED_FIELDS.entries()) {
    const row = await prisma.customField.upsert({
      where: { workspaceId_key: { workspaceId, key: f.key } },
      create: { workspaceId, key: f.key, label: f.label, type: f.type, builtIn: !!f.builtIn, options: f.options ?? [], sortOrder: i },
      update: {},
    });
    ids.set(f.key, row.id);
  }
  const links = [
    ...J_FIELDS.map((k) => ({ setterId: setters.j.id, fieldId: ids.get(k)! })),
    ...NOVA_FIELDS.map((k) => ({ setterId: setters.nova.id, fieldId: ids.get(k)! })),
  ];
  await prisma.setterField.createMany({ data: links, skipDuplicates: true });
}

async function upsertResource(workspaceId: string, slug: string, data: Omit<Prisma.ResourceUncheckedCreateInput, "workspaceId" | "slug">) {
  return prisma.resource.upsert({ where: { workspaceId_slug: { workspaceId, slug } }, create: { workspaceId, slug, ...data }, update: {} });
}

async function ensureResources(workspaceId: string, setterIds: string[]) {
  const starter = await upsertResource(workspaceId, "setter-starter", {
    kind: "resource",
    name: "Claude Code Setter Starter",
    link: "https://kevinfernandes.me/setter-starter",
    keyword: "SETTER",
    status: "ACTIVE",
    description: "The exact setup Kevin runs his DMs on. Free, about 10 minutes.",
    data: { keywords: ["SETTER", "STARTER"] },
    sortOrder: 0,
  });
  const vault = await upsertResource(workspaceId, "script-vault", {
    kind: "resource",
    name: "DM Script Vault",
    link: "https://kevinfernandes.me/script-vault",
    keyword: "SCRIPT",
    status: "ACTIVE",
    description: "The 12 DM scripts Kevin actually uses.",
    data: { keywords: ["SCRIPT"] },
    sortOrder: 1,
  });
  for (const [i, e] of EPISODES.entries()) {
    await upsertResource(workspaceId, e.slug, { kind: "episode", name: e.name, link: e.link, status: "ACTIVE", data: { when: e.when }, sortOrder: i });
  }
  await prisma.setterResource.createMany({
    data: setterIds.flatMap((setterId) => [starter.id, vault.id].map((resourceId) => ({ setterId, resourceId }))),
    skipDuplicates: true,
  });

  // Keyword → resource. Real automations when they exist, else stand-in ids
  // (Resources also reads Resource.data.keywords, so every keyword shows).
  for (const [keyword, resourceId] of [["SETTER", starter.id], ["STARTER", starter.id], ["SCRIPT", vault.id]] as const) {
    const auto = await prisma.automation.findFirst({ where: { workspaceId, keywords: { has: keyword } }, select: { id: true } });
    const automationId = auto?.id ?? `seed-automation-${keyword.toLowerCase()}`;
    await prisma.campaignResource.upsert({ where: { automationId }, create: { workspaceId, automationId, resourceId }, update: {} });
  }
}

async function ensureBroadcast(workspaceId: string, setterId: string) {
  await prisma.broadcast.upsert({
    where: { workspaceId_key: { workspaceId, key: FOLLOW_UP_FRIDAY.key } },
    create: {
      workspaceId,
      key: FOLLOW_UP_FRIDAY.key,
      name: FOLLOW_UP_FRIDAY.name,
      audienceTagId: (await prisma.tag.findFirst({ where: { workspaceId, name: FOLLOW_UP_FRIDAY.tag }, select: { id: true } }))?.id ?? null,
      template: "hey {first_name}, just put this out and thought of you\n\n{link}",
      bubbles: [{ type: "text", text: "hey {first_name}, just put this out and thought of you" }, { type: "link", url: null, resourceId: null }],
      followupTemplate: "no pressure at all, curious what you think",
      setterId,
    },
    update: {},
  });
}

/** Spread n events over the last 7 days, deterministic per index. */
export function seedEvents(workspaceId: string, now: Date, setterId: string | null): OsEventInput[] {
  const out: OsEventInput[] = [];
  for (const [kind, n] of SEED_FUNNEL) {
    for (let i = 0; i < n; i++) {
      // Golden-ratio spacing keeps them spread without randomness.
      const frac = ((i * 0.618033988749895) % 1) * 0.98 + 0.01;
      out.push({ workspaceId, kind, dedupeKey: `seed:${kind}:${i}`, setterId, at: new Date(now.getTime() - frac * 7 * 86400_000), data: { seed: true } });
    }
  }
  return out;
}

async function ensureEvents(workspaceId: string, setterId: string) {
  // The seed's events live in a fixed 7-day window from the first run; re-runs
  // add nothing (dedupe keys), so move them to "now" when they have aged out.
  const oldest = await prisma.osEvent.findFirst({ where: { workspaceId, dedupeKey: { startsWith: "seed:" } }, orderBy: { at: "asc" }, select: { at: true } });
  if (oldest && Date.now() - oldest.at.getTime() > 7 * 86400_000) {
    await prisma.osEvent.deleteMany({ where: { workspaceId, dedupeKey: { startsWith: "seed:" } } });
  }
  return recordEvents(seedEvents(workspaceId, new Date(), setterId));
}

async function ensureDocs(setter: { id: string; voice: string; examples: string }) {
  const docs: [string, string][] = [
    ["system_prompt", `# J\n\nYou are J, Kevin's setter on @claudepreneur. Peer to peer, never pushy.\n\n## Voice\n\n${setter.voice || "Short, lowercase, curious."}`],
    ["business", "# Business\n\nKevin builds AI agents with founders and creators: hands-on, not a course."],
    ["offers", "# Offers\n\n## Case study build\n\nStatus: open. Sold by: call. We build the first agents together."],
    ["objections", "# Objections\n\n## Too expensive\n\nAcknowledge, then ask what fixing it is worth to them."],
    ["examples", setter.examples || "# Examples\n"],
  ];
  for (const [key, body] of docs) {
    const existing = await prisma.setterDoc.findUnique({ where: { setterId_key: { setterId: setter.id, key } } });
    if (existing) continue;
    const doc = await prisma.setterDoc.create({ data: { setterId: setter.id, key, body, updatedBy: "seed" } });
    await prisma.setterDocRevision.create({ data: { docId: doc.id, body, author: "seed" } });
  }
}

async function main() {
  const ws = await ensureUser();
  await prisma.osWorkspace.upsert({ where: { workspaceId: ws.id }, create: { workspaceId: ws.id }, update: {} });
  const setters = await ensureSetters(ws.id);
  await ensureFields(ws.id, setters);
  await ensureResources(ws.id, [setters.j.id, setters.nova.id]);
  await ensureBroadcast(ws.id, setters.j.id);
  const added = await ensureEvents(ws.id, setters.j.id);
  await ensureDocs(setters.j);
  const counts = await Promise.all(OS_EVENT_KINDS.map(async (k) => [k, await prisma.osEvent.count({ where: { workspaceId: ws.id, kind: k } })] as const));
  console.log(`Seeded workspace ${ws.id} (${ws.name}). Setters J ${setters.j.id}, Nova ${setters.nova.id}. Events +${added}: ${counts.map(([k, n]) => `${k} ${n}`).join(", ")}`);
  console.log(`Session cookie: authjs.session-token=${SESSION}`);
}

if (process.argv[1]?.endsWith("os-seed-dev.ts")) {
  main()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
