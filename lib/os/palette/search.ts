// ⌘K palette search (Palette board). Pure: the index comes from
// lib/os/palette/index.ts, the UI is components/os/palette/mount.tsx.
// Groups: Contacts (threads), Actions (on the open thread), Go to (screens and
// KB docs). A leading ">" shows actions only.

export interface PaletteContact {
  id: string;
  username: string | null;
  fullName: string | null;
  conversationId: string | null;
  /** Column label from the setter's funnel, e.g. "Qualify". */
  stage: string | null;
  draftWaiting: boolean;
  setterId: string | null;
}

export interface PaletteScreen {
  key: string;
  label: string;
  href: string;
  /** G-chord second key, e.g. "F" for G F. */
  chord?: string;
  /** Extra words that find it ("experiments" → Tests). */
  words?: string[];
  /** Breadcrumb shown before the label, muted. */
  trail?: string;
}

export interface PaletteDoc {
  setterId: string;
  setterName: string;
  key: string;
  file: string;
  href: string;
}

export type PaletteActionKey = "approve" | "hold" | "regenerate" | "focus-draft" | "move-stage" | "send-resource" | "open-instagram";

export interface PaletteAction {
  key: PaletteActionKey;
  label: string;
  keys: string[];
  /** Opens a second list (stages, lead magnets). */
  picks?: boolean;
  words?: string[];
}

export const PALETTE_ACTIONS: PaletteAction[] = [
  { key: "approve", label: "Approve current draft", keys: ["⏎"], words: ["send", "approve"] },
  { key: "hold", label: "Hold draft", keys: ["H"], words: ["wait", "skip"] },
  { key: "regenerate", label: "Regenerate draft", keys: ["R"], words: ["redo", "rewrite"] },
  { key: "focus-draft", label: "Edit draft", keys: ["E"], words: ["write", "focus"] },
  { key: "move-stage", label: "Move to stage…", keys: ["S"], picks: true, words: ["stage", "pipeline"] },
  { key: "send-resource", label: "Send lead magnet…", keys: ["L"], picks: true, words: ["resource", "link", "magnet"] },
  { key: "open-instagram", label: "Open in Instagram", keys: ["⌘", "O"], words: ["ig", "instagram"] },
];

export const DOC_FILES: Record<string, string> = {
  system_prompt: "System prompt.md",
  business: "Business.md",
  offers: "Offers.md",
  objections: "Objections.md",
  examples: "Examples.md",
};

/** Screens and their G-chords (G H, G I, …). */
export const PALETTE_SCREENS: PaletteScreen[] = [
  { key: "home", label: "Home", href: "/os", chord: "H" },
  { key: "inbox", label: "Inbox", href: "/os/inbox", chord: "I", words: ["drafts", "threads", "dms"] },
  { key: "contacts", label: "Contacts", href: "/os/contacts", chord: "C", words: ["kanban", "pipeline", "leads"] },
  { key: "followups", label: "Follow-ups", href: "/os/follow-ups", chord: "F", words: ["followups", "scheduled", "nudges"] },
  { key: "automations", label: "Automations", href: "/os/automations", chord: "A", words: ["campaigns", "keywords"] },
  { key: "broadcasts", label: "Broadcasts", href: "/os/automations/broadcasts", trail: "Automations › ", words: ["follow-up friday", "friday"] },
  { key: "tests", label: "Tests", href: "/os/automations/tests", trail: "Automations › ", words: ["experiments", "a/b", "ab"] },
  { key: "knowledge", label: "Knowledge bases", href: "/os/knowledge", chord: "K", words: ["setters", "kb", "docs"] },
  { key: "resources", label: "Resources", href: "/os/knowledge/resources", trail: "Knowledge bases › ", words: ["lead magnets", "episodes"] },
  { key: "settings", label: "Settings", href: "/os/settings", chord: "S" },
  { key: "integrations", label: "Integrations", href: "/os/settings?tab=integrations", trail: "Settings › ", words: ["kit", "cal.com", "calendly", "gohighlevel", "data os"] },
  { key: "fields", label: "Custom fields", href: "/os/settings?tab=fields", trail: "Settings › ", words: ["fields"] },
];

/** G then this key → screen href. */
export function chordHref(key: string): string | null {
  const k = key.toUpperCase();
  return PALETTE_SCREENS.find((s) => s.chord === k)?.href ?? null;
}

const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/**
 * How well `q` matches `text`: 0 = no match. Exact > prefix > word start >
 * substring > in-order letters (fuzzy, short queries excluded).
 */
export function score(text: string | null | undefined, q: string): number {
  if (!text) return 0;
  const t = fold(text);
  const n = fold(q.trim());
  if (!n) return 1;
  if (t === n) return 100;
  if (t.startsWith(n)) return 80;
  const i = t.indexOf(n);
  if (i > 0 && /[^a-z0-9]/.test(t[i - 1])) return 60;
  if (i >= 0) return 40;
  if (n.length < 3) return 0;
  let j = 0;
  for (const ch of t) if (ch === n[j]) j++;
  return j === n.length ? 10 : 0;
}

/** [start, end) of the query inside text, for bolding; null when only fuzzy. */
export function matchRange(text: string, q: string): [number, number] | null {
  const n = fold(q.trim());
  if (!n) return null;
  const i = fold(text).indexOf(n);
  return i < 0 ? null : [i, i + n.length];
}

export interface PaletteQuery {
  /** Text after an optional leading ">". */
  text: string;
  actionsOnly: boolean;
}

export function parseQuery(raw: string): PaletteQuery {
  const t = raw.trimStart();
  return t.startsWith(">") ? { text: t.slice(1).trim(), actionsOnly: true } : { text: raw.trim(), actionsOnly: false };
}

export interface PaletteResults {
  contacts: PaletteContact[];
  actions: PaletteAction[];
  screens: PaletteScreen[];
  docs: PaletteDoc[];
}

const best = (q: string, ...fields: (string | null | undefined)[]) => Math.max(0, ...fields.map((f) => score(f, q)));

function rank<T>(items: T[], q: string, fields: (x: T) => (string | null | undefined)[], limit: number): T[] {
  return items
    .map((x, i) => ({ x, i, s: best(q, ...fields(x)) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((r) => r.x);
}

/**
 * Pure: everything that matches. Actions only appear with a thread open
 * (`hasThread`). Docs here match by name; full-text doc hits come from the
 * server (searchDocs) and are merged by the UI.
 */
export function searchPalette(
  raw: string,
  index: { contacts: PaletteContact[]; docs: PaletteDoc[] },
  hasThread: boolean,
  /** The open thread: typing its name lists every action for it (Palette board). */
  thread?: Pick<PaletteContact, "username" | "fullName"> | null
): PaletteResults {
  const { text, actionsOnly } = parseQuery(raw);
  const aboutThread = !!thread && !!text && best(text, thread.username, thread.fullName) >= 40;
  const actions = !hasThread ? [] : aboutThread ? PALETTE_ACTIONS : rank(PALETTE_ACTIONS, text, (a) => [a.label, ...(a.words ?? [])], 20);
  if (actionsOnly) return { contacts: [], actions, screens: [], docs: [] };
  if (!text) {
    // Nothing typed: threads waiting on Kevin first, then the screens.
    return { contacts: index.contacts.filter((c) => c.draftWaiting).slice(0, 5), actions, screens: PALETTE_SCREENS.filter((s) => s.chord), docs: [] };
  }
  return {
    contacts: rank(index.contacts, text, (c) => [c.username, c.fullName], 6),
    actions,
    screens: rank(PALETTE_SCREENS, text, (s) => [s.label, ...(s.words ?? [])], 5),
    docs: rank(index.docs, text, (d) => [d.file, `${d.setterName} ${d.file}`], 4),
  };
}

/** Where a contact opens: its thread in the Inbox, else the Contacts panel. */
export function contactHref(c: Pick<PaletteContact, "id" | "conversationId">): string {
  return c.conversationId ? `/os/inbox?c=${encodeURIComponent(c.conversationId)}` : `/os/contacts?contact=${encodeURIComponent(c.id)}`;
}

/** Instagram DM link for a handle. */
export function instagramHref(username: string | null): string | null {
  return username ? `https://ig.me/m/${encodeURIComponent(username)}` : null;
}

/** The open thread from the URL: /os/inbox?c=<conversationId> or ?contact=<id>. */
export function threadFromUrl(pathname: string, search: string, contacts: PaletteContact[]): PaletteContact | null {
  if (!pathname.startsWith("/os")) return null;
  const p = new URLSearchParams(search);
  const conv = p.get("c");
  const id = p.get("contact");
  if (conv) return contacts.find((c) => c.conversationId === conv) ?? null;
  if (id) return contacts.find((c) => c.id === id) ?? null;
  return null;
}

/** "…stuck on what to post with Notion and…" around the first hit. */
export function snippet(body: string, q: string, radius = 32): string | null {
  const r = matchRange(body, q);
  if (!r) return null;
  const start = Math.max(0, r[0] - radius);
  const end = Math.min(body.length, r[1] + radius);
  const flat = body.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${flat}${end < body.length ? "…" : ""}`;
}
