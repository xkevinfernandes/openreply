// Managed tags (dm-crm slice 2), pure parts: the key variants share, the
// system tags, the merge plan. The seed migration
// (prisma/migrations/20261027020000_os_crm_tags_seed) follows the same rules
// in SQL; __tests__/os/tags.test.ts keeps the two in step.

/** Variants that differ only in case, surrounding spaces or separators share
 *  this key: "Follow-up-friday", "follow up friday", "follow_up_friday". */
export function tagKey(name: string): string {
  return name
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/** A tag name as stored: trimmed, inner whitespace collapsed, at most 40 chars. */
export function cleanTagName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, 40);
}

/** Tags something reads by name. Seeded in every workspace; can't be renamed
 *  or deleted, and a seed merge always keeps this name. `readBy` is the
 *  badge's tooltip. */
export const SYSTEM_TAGS: readonly { name: string; readBy: string }[] = [
  { name: "client", readBy: "J's freeze rules (never drafts or nudges)" },
  { name: "friend", readBy: "J's freeze rules (never drafts or nudges)" },
  { name: "agent_paused", readBy: "J's freeze rules (never drafts or nudges)" },
  { name: "booked", readBy: "J's state machine (call booked)" },
  { name: "not_now", readBy: "J's state machine (not now)" },
  { name: "not_now_auto", readBy: "J's triage (not now until they write again)" },
  { name: "follow-up-friday", readBy: "Follow-up Friday" },
];

export const SYSTEM_TAG_NAMES: ReadonlySet<string> = new Set(SYSTEM_TAGS.map((t) => t.name));

export function systemTagFor(name: string): { name: string; readBy: string } | null {
  const k = tagKey(name);
  return SYSTEM_TAGS.find((t) => tagKey(t.name) === k) ?? null;
}

export interface TagSeedPlan {
  name: string;
  key: string;
  system: boolean;
  /** Primary first. */
  kitNames: string[];
  /** Variants merged into it (not its name). */
  merged: string[];
}

/**
 * What the seed makes of one workspace's tags: one tag per key, the system
 * name or else the most used variant (ties: the lower-case one, then
 * alphabetical); Kit names = the variants already pushed, most pushed first.
 */
export function planTagSeed(used: { name: string; count: number }[], pushedToKit: { name: string; count: number }[] = []): TagSeedPlan[] {
  const groups = new Map<string, { name: string; count: number }[]>();
  const add = (name: string, count: number) => {
    const n = name.trim();
    const k = tagKey(n);
    if (!k) return;
    const g = groups.get(k) ?? [];
    const hit = g.find((x) => x.name === n);
    if (hit) hit.count += count;
    else g.push({ name: n, count });
    groups.set(k, g);
  };
  for (const s of SYSTEM_TAGS) add(s.name, 0);
  for (const u of used) add(u.name, u.count);
  const kit = new Map<string, { name: string; count: number }[]>();
  for (const p of pushedToKit) {
    const k = tagKey(p.name);
    if (!k) continue;
    const g = kit.get(k) ?? [];
    const hit = g.find((x) => x.name === p.name.trim());
    if (hit) hit.count += p.count;
    else g.push({ name: p.name.trim(), count: p.count });
    kit.set(k, g);
  }
  const byUse = (a: { name: string; count: number }, b: { name: string; count: number }) =>
    b.count - a.count || Number(b.name === b.name.toLowerCase()) - Number(a.name === a.name.toLowerCase()) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const out: TagSeedPlan[] = [];
  for (const [key, variants] of groups) {
    const sys = SYSTEM_TAGS.find((s) => tagKey(s.name) === key);
    const name = sys ? sys.name : [...variants].sort(byUse)[0].name;
    const pushed = [...(kit.get(key) ?? [])].sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map((p) => p.name);
    const merged = [...new Set([...variants.map((v) => v.name), ...pushed])].filter((v) => v !== name).sort();
    out.push({ name, key, system: Boolean(sys), kitNames: pushed.length ? pushed : [name], merged });
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : 1));
}
