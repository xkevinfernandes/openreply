// The words a delete dialog uses for what still uses something (tags and
// resources share them, so both dialogs read the same).

/** "the broadcast "Guide drop" and the workflow "SEND keyword"". A name that
 *  already starts with its kind ("Campaign SETTER") isn't doubled. */
export function usedByWords(used: { kind: string; name: string }[]): string {
  const parts = used.map((u) => {
    const kind = u.kind.toLowerCase();
    const name = u.name.toLowerCase().startsWith(`${kind} `) ? u.name.slice(kind.length + 1) : u.name;
    return `the ${kind} "${name}"`;
  });
  const unique = [...new Set(parts)];
  if (unique.length <= 1) return unique[0] ?? "";
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

/** The delete dialog's title, words and confirm button (null: no delete). */
export function deleteCheckWords({ name, used, refuse = false }: { name: string; used: { kind: string; name: string }[]; refuse?: boolean }): { title: string; hint: string | null; confirm: string | null } {
  if (!used.length) return { title: `Delete "${name}"?`, hint: null, confirm: "Delete" };
  const by = `It's used by ${usedByWords(used)}.`;
  return refuse
    ? { title: `"${name}" is in use`, hint: `${by} Remove it there first.`, confirm: null }
    : { title: `"${name}" is in use`, hint: `${by} Delete anyway and they stop matching.`, confirm: "Delete anyway" };
}
