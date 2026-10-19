// Voice bank matching, the pure half (SetDM's "Audio Arsenal"): when a bubble
// J sends contains an active bank clip's line, and this person hasn't heard
// that clip, the recording goes instead of those words. Nothing here does
// I/O, so the tests use it directly.

export interface BankClip {
  id: string;
  label: string;
  phrase: string;
  /** Lead-in: matches only at the start of a bubble; the rest follows as text. */
  leadIn: boolean;
  audioId: string;
  /** m4a | wav | aac */
  ext: string;
  /** Same-origin path, for the players. */
  url: string;
  durationMs: number | null;
}

export type SendPart =
  | { type: "text"; text: string }
  | { type: "voice"; clip: BankClip };

/** One bubble, as it will go out: text and/or voice parts, in order. */
export type BubblePlan = SendPart[];

/** Lowercase, accents and apostrophes gone ("what's" = "whats"), every other
 *  run of non-letters one space. Emoji and punctuation never block a match. */
export function normalise(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’‘`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** A phrase short enough to hit by accident ("hey") never auto-matches. */
export const MIN_PHRASE_WORDS = 3;

export function matchable(phrase: string): boolean {
  const n = normalise(phrase);
  return n.length > 0 && n.split(" ").length >= MIN_PHRASE_WORDS;
}

/** Where a normalised phrase sits in the original text, word-boundary safe.
 *  Returns the [start, end) slice of `text` it covers, or null. */
export function findPhrase(text: string, phrase: string, atStart = false): [number, number] | null {
  const target = normalise(phrase);
  if (!target) return null;
  // Normalise character by character so we can map back to the original.
  const map: number[] = [];
  let norm = "";
  let lastSpace = true;
  for (let i = 0; i < text.length; i++) {
    const n = normalise(text[i]!);
    // normalise() trims, so a separator comes back empty: turn it into one space.
    if (/['’‘`´]/.test(text[i]!)) continue;
    if (!n) {
      if (!lastSpace) {
        norm += " ";
        map.push(i);
        lastSpace = true;
      }
      continue;
    }
    for (const ch of n) {
      norm += ch;
      map.push(i);
    }
    lastSpace = false;
  }
  const hay = ` ${norm} `;
  const at = hay.indexOf(` ${target} `);
  if (at < 0) return null;
  // hay index at+1 is norm index `at`.
  const startN = at;
  const endN = at + target.length - 1;
  if (atStart && norm.slice(0, startN).trim()) return null;
  const start = map[startN]!;
  let end = map[endN]! + 1;
  // Swallow trailing punctuation that belonged to the line ("..", "?").
  while (end < text.length && /[.?!…,]/.test(text[end]!)) end++;
  return [start, end];
}

/** Leftover text worth sending: it has at least one letter or digit. */
function leftover(s: string): string | null {
  const t = s.trim().replace(/^[,;:\-–—]+\s*/, "");
  return /[\p{L}\p{N}]/u.test(t) ? t : null;
}

function planOne(text: string, clips: BankClip[], used: Set<string>): BubblePlan {
  let best: { clip: BankClip; at: [number, number] } | null = null;
  for (const clip of clips) {
    if (used.has(clip.id)) continue;
    const at = findPhrase(text, clip.phrase, clip.leadIn);
    if (at && (!best || at[0] < best.at[0] || (at[0] === best.at[0] && at[1] > best.at[1]))) best = { clip, at };
  }
  if (!best) return [{ type: "text", text }];
  used.add(best.clip.id);
  const before = leftover(text.slice(0, best.at[0]));
  const after = leftover(text.slice(best.at[1]));
  return [
    ...(before ? planOne(before, clips, used) : []),
    { type: "voice" as const, clip: best.clip },
    ...(after ? planOne(after, clips, used) : []),
  ];
}

/**
 * Which bubbles (or parts of bubbles) go as voice. `clips` are the setter's
 * active bank clips that have audio; `heard` the clip ids this person already
 * got. Each clip plays at most once per draft and once per person; the words
 * around a line still go as text, before and after it.
 */
export function planBubbles(bubbles: string[], clips: BankClip[], heard: Iterable<string> = []): BubblePlan[] {
  const used = new Set(heard);
  const usable = clips.filter((c) => c.audioId && matchable(c.phrase));
  return bubbles.map((b) => planOne(b, usable, used));
}

export function voiceCount(plan: BubblePlan[]): number {
  return plan.reduce((n, b) => n + b.filter((p) => p.type === "voice").length, 0);
}

/** The prompt block that teaches J the lines this person hasn't heard yet. */
export function voiceBlock(clips: Pick<BankClip, "phrase" | "leadIn" | "label">[], who: string, operator?: string | null): string {
  const lines = clips.filter((c) => matchable(c.phrase));
  if (!lines.length) return "";
  const by = operator ? `${operator}'s` : "your";
  const plain = lines.filter((c) => !c.leadIn);
  const leads = lines.filter((c) => c.leadIn);
  const out = [
    "VOICE NOTES",
    `These lines are pre-recorded in ${by} real voice. When one of them is what you'd naturally say next, ` +
      "use it WORD FOR WORD: it goes out as a voice note instead of text, which reads as more human. " +
      `Each plays once per person; these are the ones ${who} hasn't heard yet. Never force one in and never ` +
      "reword it; if none fits, ignore them all.",
  ];
  if (plain.length) {
    out.push("Use as its own bubble:");
    for (const c of plain) out.push(`- "${c.phrase.trim()}"`);
  }
  if (leads.length) {
    out.push("Lead-ins (start a bubble with the line, then carry on with the message in the same bubble):");
    for (const c of leads) out.push(`- "${c.phrase.trim()}"`);
  }
  return out.join("\n");
}
