// OS_MOCK=1 sample data for the DM CRM foundation (dm-crm part A): managed
// tags, the inbox fields on each sample contact (unread, starred, spam,
// archived), the stage log and the workspace currency. In memory on
// globalThis like the rest of the mock (lib/os/mock.ts); gone on restart.
// Screen streams add their own samples in lib/os/mock-<area>.ts.

import { mockContactExtras, mockThreads, updateMockContactExtras } from "@/lib/os/mock";
import type { TagStoreDb, TagAliasView, TagResult, TagUsage, ManagedTag } from "@/lib/os/tags/store";
import { tagView } from "@/lib/os/tags/store";
import { cleanTagName, SYSTEM_TAGS, systemTagFor, tagKey } from "@/lib/os/tags/key";

type TagRow = { id: string; workspaceId: string; name: string; key: string; color: string; kitNames: string[]; system: boolean };
type AliasRow = TagAliasView & { workspaceId: string; key: string };

/** CRM fields of one sample contact (the Contact columns added by dm-crm). */
export interface MockCrmState {
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  lastOpenedAt: string | null;
  lastPersonalSendAt: string | null;
  starred: boolean;
  spam: boolean;
  spamOverride: boolean | null;
  archivedAt: string | null;
}

export interface MockStageLogRow {
  id: string;
  workspaceId: string;
  contactId: string;
  setterId: string | null;
  fromColumn: string | null;
  toColumn: string;
  outcome: "applied" | "refused";
  cause: string;
  reason: string | null;
  at: string;
}

interface MockCrm {
  tags: TagRow[];
  aliases: AliasRow[];
  state: Map<string, MockCrmState>;
  stageLog: MockStageLogRow[];
  currency: string;
  seq: number;
}

const mem: MockCrm = ((globalThis as { __osMockCrm?: MockCrm }).__osMockCrm ??= {
  tags: [],
  aliases: [],
  state: new Map(),
  stageLog: [],
  currency: "EUR",
  seq: 0,
});

const nextId = (p: string) => `${p}${++mem.seq}`;

/** Colours for the sample tags, so the Tags screen isn't all grey. */
const SAMPLE_COLORS: Record<string, string> = { hot: "red", agency: "blue", client: "green", booked: "teal", "follow-up-friday": "purple" };

function seedTags(workspaceId: string) {
  if (mem.tags.some((t) => t.workspaceId === workspaceId)) return;
  const names = new Set<string>(SYSTEM_TAGS.map((s) => s.name));
  for (const t of mockThreads()) if (t.contact) for (const n of mockContactExtras(t.contact.id).tags) names.add(n);
  for (const name of names) {
    const sys = systemTagFor(name);
    mem.tags.push({
      // Stable ids for the sample (the broadcast mock points at tag-follow-up-friday).
      id: `tag-${tagKey(name)}`,
      workspaceId,
      name,
      key: tagKey(name),
      color: SAMPLE_COLORS[name] ?? "gray",
      kitNames: [name],
      system: Boolean(sys),
    });
  }
  // One merged variant, so Settings › Tags has an old name to show.
  const nn = mem.tags.find((t) => t.workspaceId === workspaceId && t.name === "not_now");
  if (nn) mem.aliases.push({ id: nextId("alias"), workspaceId, tagId: nn.id, name: "Not-Now", key: tagKey("Not-Now") });
}

export function mockTagStore(): TagStoreDb {
  const ws = (workspaceId: string) => (seedTags(workspaceId), mem.tags.filter((t) => t.workspaceId === workspaceId));
  return {
    async list(workspaceId) {
      return [...ws(workspaceId)].sort((a, b) => a.name.localeCompare(b.name));
    },
    async byName(workspaceId, name) {
      return ws(workspaceId).find((t) => t.name === name) ?? null;
    },
    async byKey(workspaceId, key) {
      return ws(workspaceId).find((t) => t.key === key) ?? null;
    },
    async aliasByKey(workspaceId, key) {
      ws(workspaceId);
      const a = [...mem.aliases].reverse().find((x) => x.workspaceId === workspaceId && x.key === key);
      const tag = a ? mem.tags.find((t) => t.id === a.tagId) : null;
      return a && tag ? { id: a.id, name: a.name, tagId: a.tagId, tag } : null;
    },
    async aliases(workspaceId) {
      ws(workspaceId);
      return mem.aliases.filter((a) => a.workspaceId === workspaceId).map(({ id, name, tagId }) => ({ id, name, tagId }));
    },
    async create(workspaceId, data) {
      const hit = ws(workspaceId).find((t) => t.key === data.key);
      if (hit) return hit;
      const row = { id: nextId("tag"), workspaceId, ...data };
      mem.tags.push(row);
      return row;
    },
  };
}

function sampleContactIds(): string[] {
  return mockThreads().flatMap((t) => (t.contact ? [t.contact.id] : []));
}

export function mockRenameTag(workspaceId: string, id: string, newName: string): TagResult {
  seedTags(workspaceId);
  const tag = mem.tags.find((t) => t.id === id && t.workspaceId === workspaceId);
  if (!tag) return { ok: false, error: "That tag is gone. Refresh." };
  if (tag.system) return { ok: false, error: `${tag.name} is a system tag: ${systemTagFor(tag.name)?.readBy ?? "something"} reads it by name.` };
  const name = cleanTagName(newName);
  const key = tagKey(name);
  if (!key) return { ok: false, error: "Name the tag." };
  const live = mem.tags.find((t) => t.workspaceId === workspaceId && t.key === key && t.id !== id);
  if (live) return { ok: false, error: `There's already a tag called ${live.name}.` };
  const alias = mem.aliases.find((a) => a.workspaceId === workspaceId && a.key === key && a.tagId !== id);
  if (alias) return { ok: false, error: `This was the old name of ${mem.tags.find((t) => t.id === alias.tagId)?.name ?? "another tag"}.` };
  mem.aliases = mem.aliases.filter((a) => !(a.tagId === id && a.key === key));
  mem.aliases.push({ id: nextId("alias"), workspaceId, tagId: id, name: tag.name, key: tag.key });
  for (const cid of sampleContactIds()) {
    const tags = mockContactExtras(cid).tags;
    if (tags.includes(tag.name)) updateMockContactExtras(cid, { tags: [...new Set(tags.map((t) => (t === tag.name ? name : t)))] });
  }
  tag.name = name;
  tag.key = key;
  return { ok: true, tag: tagView(tag) };
}

export function mockSetTagColor(workspaceId: string, id: string, color: string): TagResult {
  seedTags(workspaceId);
  const tag = mem.tags.find((t) => t.id === id && t.workspaceId === workspaceId);
  if (!tag) return { ok: false, error: "That tag is gone. Refresh." };
  tag.color = color;
  return { ok: true, tag: tagView(tag) };
}

export async function mockTagUsage(workspaceId: string, id: string): Promise<TagUsage> {
  seedTags(workspaceId);
  const tag = mem.tags.find((t) => t.id === id && t.workspaceId === workspaceId);
  if (!tag) return { contacts: 0, broadcasts: [], workflows: [] };
  const contacts = sampleContactIds().filter((cid) => mockContactExtras(cid).tags.includes(tag.name)).length;
  const { mockBroadcastStore } = await import("@/lib/os/mock-followups");
  const broadcasts = (await mockBroadcastStore().list(workspaceId))
    .filter((b) => b.audienceTagId === id && b.status !== "sent" && b.status !== "cancelled")
    .map((b) => ({ id: b.id, key: b.key, name: b.name }));
  return { contacts, broadcasts, workflows: [] };
}

export async function mockDeleteTag(workspaceId: string, id: string, opts: { force?: boolean }): Promise<{ ok: true } | { ok: false; error: string; usage?: TagUsage }> {
  const tag = mem.tags.find((t) => t.id === id && t.workspaceId === workspaceId);
  if (!tag) return { ok: false, error: "That tag is gone. Refresh." };
  if (tag.system) return { ok: false, error: `${tag.name} is a system tag: ${systemTagFor(tag.name)?.readBy ?? "something"} reads it by name.` };
  const usage = await mockTagUsage(workspaceId, id);
  if (!opts.force && (usage.broadcasts.length || usage.workflows.length)) {
    return { ok: false, error: `Used by ${[...usage.broadcasts.map((b) => b.name), ...usage.workflows.map((w) => w.name)].join(", ")}.`, usage };
  }
  for (const cid of sampleContactIds()) {
    const tags = mockContactExtras(cid).tags;
    if (tags.includes(tag.name)) updateMockContactExtras(cid, { tags: tags.filter((t) => t !== tag.name) });
  }
  mem.tags = mem.tags.filter((t) => t.id !== id);
  mem.aliases = mem.aliases.filter((a) => a.tagId !== id);
  return { ok: true };
}

export function mockFreeAlias(workspaceId: string, aliasId: string): { ok: boolean } {
  const before = mem.aliases.length;
  mem.aliases = mem.aliases.filter((a) => !(a.id === aliasId && a.workspaceId === workspaceId));
  return { ok: mem.aliases.length < before };
}

export function mockTags(workspaceId: string): ManagedTag[] {
  seedTags(workspaceId);
  return mem.tags.filter((t) => t.workspaceId === workspaceId).map(tagView);
}

// --- Inbox fields on the sample contacts ---------------------------------------

const hoursAgoIso = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

/** Sample state: c2 and c5 unread, c3 starred, c7 (a pitch) flagged as spam,
 *  c10 archived, the rest read. Times follow each thread's last message. */
function seedState(contactId: string): MockCrmState {
  const t = mockThreads().find((x) => x.contact?.id === contactId);
  const last = t?.updatedTime ?? null;
  const base: MockCrmState = {
    lastInboundAt: last,
    lastOutboundAt: last,
    lastOpenedAt: last,
    lastPersonalSendAt: null,
    starred: false,
    spam: false,
    spamOverride: null,
    archivedAt: null,
  };
  switch (contactId) {
    case "c1":
      return { ...base, lastOutboundAt: hoursAgoIso(0.5), lastPersonalSendAt: hoursAgoIso(0.5) };
    case "c2":
      // They wrote last 1h ago and nobody opened it: unread, window closing in ~23h.
      return { ...base, lastOutboundAt: hoursAgoIso(3), lastOpenedAt: hoursAgoIso(3) };
    case "c5":
      // Unread and their 24h window closes in about 2h ("Window closing").
      return { ...base, lastInboundAt: hoursAgoIso(22), lastOutboundAt: hoursAgoIso(26), lastOpenedAt: hoursAgoIso(26) };
    case "c3":
      return { ...base, starred: true, lastPersonalSendAt: hoursAgoIso(3) };
    case "c7":
      return { ...base, spam: true };
    case "c10":
      return { ...base, archivedAt: hoursAgoIso(48) };
    default:
      return base;
  }
}

export function mockCrmState(contactId: string): MockCrmState {
  let s = mem.state.get(contactId);
  if (!s) {
    s = seedState(contactId);
    mem.state.set(contactId, s);
  }
  return s;
}

export function updateMockCrmState(contactId: string, patch: Partial<MockCrmState>): MockCrmState {
  const s = mockCrmState(contactId);
  Object.assign(s, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
  return s;
}

// --- Stage log -----------------------------------------------------------------

export function mockStageLog(contactId?: string): MockStageLogRow[] {
  return mem.stageLog.filter((r) => !contactId || r.contactId === contactId).sort((a, b) => (a.at < b.at ? 1 : -1));
}

export function appendMockStageLog(row: Omit<MockStageLogRow, "id" | "at"> & { at?: string }): MockStageLogRow {
  const full = { ...row, id: nextId("log"), at: row.at ?? new Date().toISOString() };
  mem.stageLog.push(full);
  return full;
}

// --- Workspace -----------------------------------------------------------------

export function mockCurrency(): string {
  return mem.currency;
}

export function setMockCurrency(code: string) {
  mem.currency = code;
}
