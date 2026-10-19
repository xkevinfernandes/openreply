// Instagram profile pictures come from the IG CDN with a signed expiry
// (`oe=<hex unix seconds>`). Once it passes the CDN answers 403, which the
// browser draws as a broken image. We drop dead urls before rendering so the
// initials show at once, and the inbox list read writes fresh ones back
// (lib/os/inbox.ts listThreads → Contact.avatarUrl).

/** Seconds of slack: a url that dies within a minute counts as dead. */
const SLACK_S = 60;

/** The url's expiry in ms, or null when it has none we can read. */
export function avatarExpiry(url: string): number | null {
  const m = /[?&]oe=([0-9a-fA-F]{6,10})(?:&|$)/.exec(url);
  if (!m) return null;
  const s = parseInt(m[1], 16);
  return Number.isFinite(s) ? s * 1000 : null;
}

/** The url when it can still load, else null (show the initials). */
export function liveAvatarUrl(url: string | null | undefined, now: number = Date.now()): string | null {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const exp = avatarExpiry(url);
  return exp !== null && exp - SLACK_S * 1000 <= now ? null : url;
}

/** One letter for the disc: first of the handle or name, "?" when there is none. */
export function avatarInitial(name: string | null | undefined): string {
  const ch = (name ?? "").replace(/^@/, "").trim().charAt(0);
  return ch ? ch.toUpperCase() : "?";
}
