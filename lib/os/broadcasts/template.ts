// Broadcast text rules, pure. The link is always its own bubble: whatever J
// or Kevin writes, URLs are taken out of the text bubbles and the run's link
// is appended once, alone.

const URL_RE = /https?:\/\/\S+|\b(?:www\.|youtu\.be\/|youtube\.com\/)\S+/gi;

/** First name for {first_name}: the first word of the name, else the handle's first part. */
export function firstNameOf(fullName: string | null | undefined, username: string | null | undefined): string {
  const fromName = (fullName ?? "").trim().split(/\s+/)[0];
  if (fromName) return fromName;
  const handle = (username ?? "").replace(/^@/, "").split(/[._\d]/)[0];
  return handle || "there";
}

/** One bubble per non-empty line. */
export function splitLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Text without any URL or {link}, spaces tidied. */
export function stripLinks(text: string): string {
  return text
    .replace(/\{link\}/gi, " ")
    .replace(URL_RE, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}

/** Kevin's template with {first_name} filled, the {link} removed (it goes on its own). */
export function fillTemplate(template: string, vars: { first_name: string }): string[] {
  const filled = template.replace(/\{first_name\}/gi, vars.first_name);
  return splitLines(filled).map(stripLinks).filter(Boolean);
}

/** The bubbles that go out: text bubbles without links, then the link alone. */
export function withLinkBubble(bubbles: string[], link: string | null): string[] {
  const text = bubbles.map(stripLinks).filter(Boolean);
  const clean = (link ?? "").trim();
  return clean ? [...text, clean] : text;
}

/** The text bubbles of a message (everything but the link bubble). */
export function textBubbles(bubbles: string[], link: string | null): string[] {
  const clean = (link ?? "").trim();
  return bubbles.filter((b) => b.trim() !== clean);
}

/** A pasted link, cleaned: adds https:// when missing; null when it isn't one. */
export function cleanLink(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** "youtu.be/claude-runs-my-dms": the link as the card shows it. */
export function shortLink(link: string): string {
  return link.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}
