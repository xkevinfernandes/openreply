// The bulk bar's Tag… menu (Inbox, Contacts, Pipeline), pure. "Add tag"
// lists the tags not already on every selected contact; "Remove tag" the tags
// on at least one. A tag on some of them shows in both, which is the point:
// add it to the rest, or take it off the ones that have it.

export interface BulkTagMenu {
  add: string[];
  remove: string[];
}

export function bulkTagMenu(all: string[], perContact: string[][]): BulkTagMenu {
  const any = new Set(perContact.flat());
  const onEvery = (t: string) => perContact.length > 0 && perContact.every((tags) => tags.includes(t));
  const byName = (a: string, b: string) => a.localeCompare(b);
  const known = [...new Set([...all, ...any])];
  return {
    add: known.filter((t) => !onEvery(t)).sort(byName),
    remove: [...any].sort(byName),
  };
}
