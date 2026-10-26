// Kit always sees the same tag name (dm-crm slice 2, issue 006). Each managed
// tag carries the name(s) Kit knows it by (Tag.kitNames, primary first), set
// once and never changed by a rename or merge. Field sync maps contact tags to
// Kit names before diffing against what it pushed, so a rename or a seed merge
// (Not-Now → not_now) is never seen as a removal, and Kit tag rules keep firing.
import { tagKey } from "@/lib/os/tags/key";

export interface KitTagLike {
  name: string;
  key?: string;
  kitNames: string[];
}

function find(tags: KitTagLike[], name: string): KitTagLike | null {
  const k = tagKey(name);
  return tags.find((t) => t.name === name) ?? tags.find((t) => (t.key ?? tagKey(t.name)) === k) ?? null;
}

/**
 * A contact's tags as Kit names: each tag's primary Kit name, plus its extra
 * Kit names only when this contact already has them in Kit (`pushed`, without
 * the mapping's prefix). A tag that isn't managed goes as it is.
 */
export function kitTagNames(contactTags: string[], tags: KitTagLike[], pushed: string[] = []): string[] {
  const had = new Set(pushed);
  const out: string[] = [];
  for (const t of contactTags) {
    const m = find(tags, t);
    if (!m || !m.kitNames.length) {
      out.push(t);
      continue;
    }
    out.push(m.kitNames[0]);
    for (const extra of m.kitNames.slice(1)) if (had.has(extra)) out.push(extra);
  }
  return [...new Set(out)];
}

/** Every Kit name of a tag removed on purpose (its primary and extras). */
export function kitNamesFor(name: string, tags: KitTagLike[]): string[] {
  const m = find(tags, name);
  return m?.kitNames.length ? [...m.kitNames] : [name];
}
