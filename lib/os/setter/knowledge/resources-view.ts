// Pure helpers for the Resources screen (no I/O, so tests use them directly).

export const shortLink = (url: string | null) => (url ?? "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

export function hostLabel(url: string | null): string {
  const h = shortLink(url).split("/")[0];
  return /youtu\.?be/.test(h) ? "YouTube" : h || "Link";
}

/** Move one id to another's place (drag and drop, or the arrow keys). */
export function moveId(ids: string[], from: string, to: string): string[] {
  if (from === to || !ids.includes(from)) return ids;
  const out = ids.filter((x) => x !== from);
  const at = out.indexOf(to);
  if (at === -1) return ids;
  out.splice(ids.indexOf(from) < ids.indexOf(to) ? at + 1 : at, 0, from);
  return out;
}
