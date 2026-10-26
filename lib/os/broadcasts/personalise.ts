// J writes each broadcast message for one person (broadcast mode).
// Inputs: Kevin's template, the link, what we know about the contact, and the
// state of the thread (live vs quiet). Rules the code enforces whatever the
// model writes:
//   - the link is its own bubble, appended here, never inside a text bubble
//   - no two messages of a run are the same or nearly the same
//     (lib/os/experiments/similarity.ts); a near-duplicate is rewritten
// The model call is injected, so this file stays pure and testable.

import { lineKept } from "@/lib/os/experiments/similarity";
import type { BroadcastContact } from "@/lib/os/broadcasts/types";
import { fillTemplate, firstNameOf, splitLines, stripLinks, withLinkBubble } from "@/lib/os/broadcasts/template";

const HOUR = 3_600_000;

/** A thread is live when someone wrote within this many hours of the send. */
export const LIVE_HOURS = 6;
/** Two messages sharing this much of their words (both ways) are near-duplicates. */
export const NEAR_DUPLICATE = 0.85;
/** Model rewrites before the code varies the wording itself. */
export const MAX_REWRITES = 2;

export interface ThreadState {
  live: boolean;
  /** "Live · Qualify", "Quiet 20h · Value": the card's context line. */
  label: string;
  /** One line for the prompt. */
  brief: string;
}

function hoursLabel(h: number): string {
  if (h < 1) return "<1h";
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, " ") : s;
}

/** Live vs quiet at the planned send time. */
export function threadState(c: Pick<BroadcastContact, "theirLastAt" | "ourLastAt" | "setterStage">, at: Date): ThreadState {
  const their = c.theirLastAt ? new Date(c.theirLastAt).getTime() : null;
  const ours = c.ourLastAt ? new Date(c.ourLastAt).getTime() : null;
  const last = Math.max(their ?? 0, ours ?? 0);
  const stage = c.setterStage ? cap(c.setterStage) : null;
  if (!last) return { live: false, label: ["New", stage].filter(Boolean).join(" · "), brief: "No conversation yet." };
  const hours = Math.max(0, (at.getTime() - last) / HOUR);
  const theyWroteLast = their !== null && (ours === null || their >= ours);
  const live = hours < LIVE_HOURS;
  const label = [live ? "Live" : `Quiet ${hoursLabel(hours)}`, stage].filter(Boolean).join(" · ");
  const who = theyWroteLast ? "they wrote last" : "we wrote last";
  const brief = live
    ? `LIVE thread: last message ${hoursLabel(hours)} before the send, ${who}. Slide it in like an aside ("by the way, just did this video…").`
    : `QUIET thread: last message ${hoursLabel(hours)} before the send, ${who}. Open fresh and warm ("thought of you with this…"), no guilt about the gap.`;
  return { live, label, brief };
}

export interface PersonaliseInput {
  contact: BroadcastContact;
  template: string;
  followupTemplate: string | null;
  link: string;
  /** Planned send time (for live vs quiet). */
  at: Date;
  /** The last few lines of the thread, oldest first ("THEM: …" / "US: …"). */
  recent: string[];
  /** Lines already used for other people in this run: do not echo them. */
  avoid: string[];
  /** The broadcast's name, for the prompt. */
  name: string;
}

export interface PersonalisedMessage {
  /** Text bubbles + the link alone at the end. */
  bubbles: string[];
  followupBubbles: string[];
  reasoning: string;
  state: ThreadState;
}

/** The user prompt for the broadcast-mode draft. The system prompt is J's own. */
export function buildBroadcastPrompt(i: PersonaliseInput): string {
  const c = i.contact;
  const first = firstNameOf(c.fullName, c.username);
  const state = threadState(c, i.at);
  const facts = [
    `name: ${c.fullName ?? "(unknown)"} (first name: ${first})`,
    `handle: @${c.username ?? "unknown"}`,
    c.setterStage ? `where we are: ${c.setterStage}` : null,
    c.stage ? `pipeline stage: ${c.stage}` : null,
    c.notes ? `notes: ${c.notes}` : null,
    ...c.fields.map((f) => `${f.label}: ${f.value}`),
  ].filter(Boolean);
  return [
    `DRAFT KIND: broadcast`,
    `BROADCAST: ${i.name}. Kevin is sending everyone on this list one link this week.`,
    `Write THIS person's version of Kevin's message. Keep his meaning and length, in his voice, 1-2 short bubbles.`,
    `Never put the link in your bubbles: it is sent on its own right after them. No pitch, no call ask, no question they must answer.`,
    ``,
    `TEMPLATE (Kevin's words; {first_name} = their first name, {link} = the link bubble):`,
    i.template,
    i.followupTemplate ? `\nFOLLOW-UP a few minutes later (also personalise, 1 bubble):\n${i.followupTemplate}` : `\nNo follow-up message.`,
    ``,
    `LINK (sent alone after your bubbles): ${i.link}`,
    ``,
    `THREAD STATE: ${state.brief}`,
    ``,
    `CONTACT:`,
    ...facts.map((f) => `- ${f}`),
    ``,
    `RECENT MESSAGES (oldest first):`,
    ...(i.recent.length ? i.recent.slice(-8) : ["(none)"]),
    ``,
    i.avoid.length ? `ALREADY SENT TO OTHERS ON THIS LIST: do not reuse this wording, write it differently:\n${i.avoid.map((a) => `- "${a}"`).join("\n")}\n` : ``,
    `Return JSON only: {"bubbles": ["…"], "followup": ["…"], "reasoning": "one short line: what you used about them"}`,
  ].join("\n");
}

/** Parse the model's object into clean bubbles (links taken out). */
export function parseBroadcastDraft(obj: unknown): { bubbles: string[]; followup: string[]; reasoning: string } {
  const o = (obj && typeof obj === "object" ? obj : {}) as Record<string, unknown>;
  const list = (v: unknown) =>
    (Array.isArray(v) ? v : typeof v === "string" ? splitLines(v) : [])
      .filter((x): x is string => typeof x === "string")
      .map(stripLinks)
      .filter(Boolean)
      .slice(0, 3);
  return { bubbles: list(o.bubbles), followup: list(o.followup ?? o.followup_bubbles), reasoning: typeof o.reasoning === "string" ? o.reasoning.slice(0, 300) : "" };
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9'\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The same message, or one that shares nearly all its words in order. */
export function nearDuplicate(a: string, b: string, threshold = NEAR_DUPLICATE): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return lineKept(x, y) >= threshold && lineKept(y, x) >= threshold;
}

/** The text of a message for comparison: text bubbles + follow-up, no link. */
export function messageText(bubbles: string[], followup: string[]): string {
  return [...bubbles, ...followup].map(stripLinks).filter(Boolean).join(" ");
}

export function isNearDuplicateOfAny(text: string, others: string[]): boolean {
  return others.some((o) => nearDuplicate(text, o));
}

// ---------------------------------------------------------------- deterministic writer

const LIVE_OPENERS = [
  "by the way, just put this out",
  "btw just did this video",
  "oh and random one, just posted this",
  "also, just made this one",
  "side note, this just went up",
  "unrelated but this is kinda your thing",
];
const QUIET_OPENERS = [
  "hey {first}, thought of you with this one",
  "{first}! this made me think of you",
  "saw this go out and thought of you {first}",
  "hey {first}, been meaning to send you this",
  "{first}, this one's got your name on it",
  "yo {first}, figured you'd like this",
];
const FOLLOWUPS = [
  "no pressure to watch, curious what you think",
  "watch whenever, no rush",
  "no rush at all, would love your take",
  "whenever you get a sec, no stress",
  "curious if it lands for you, no pressure",
  "zero pressure, just felt relevant",
];

function pick<T>(list: T[], i: number): T {
  return list[((i % list.length) + list.length) % list.length];
}

/**
 * The fallback writer (no model / fake backend) and the de-dupe fixer: the
 * template, shaped by live vs quiet, worded by `variant`.
 */
export function variantDraft(i: PersonaliseInput, variant: number): { bubbles: string[]; followup: string[]; reasoning: string } {
  const first = firstNameOf(i.contact.fullName, i.contact.username).toLowerCase();
  const state = threadState(i.contact, i.at);
  const opener = pick(state.live ? LIVE_OPENERS : QUIET_OPENERS, variant).replace(/\{first\}/g, first);
  const base = fillTemplate(i.template, { first_name: first });
  const bubbles = variant === 0 && base.length && !state.live ? base : [opener];
  // Opener and follow-up wording move independently: 36 combinations per thread state.
  const fuIndex = variant + Math.floor(variant / FOLLOWUPS.length);
  const followup = i.followupTemplate ? (variant === 0 ? fillTemplate(i.followupTemplate, { first_name: first }) : [pick(FOLLOWUPS, fuIndex)]) : [];
  return { bubbles, followup, reasoning: `${state.live ? "Live" : "Quiet"} thread, template wording ${variant + 1}` };
}

export type DraftWriter = (prompt: string) => Promise<unknown>;

/**
 * Write one person's message. Asks the writer (J) up to MAX_REWRITES+1 times
 * while the result is a near-duplicate of `taken`; then varies the wording
 * itself until it is unique. Always returns a message (the template as last
 * resort) so a model failure never blocks the run.
 */
export async function personaliseOne(i: PersonaliseInput, taken: string[], write: DraftWriter | null, seed = 0): Promise<PersonalisedMessage> {
  const state = threadState(i.contact, i.at);
  const finish = (d: { bubbles: string[]; followup: string[]; reasoning: string }): PersonalisedMessage => ({
    bubbles: withLinkBubble(d.bubbles, i.link),
    followupBubbles: d.followup,
    reasoning: d.reasoning,
    state,
  });
  let avoid = [...i.avoid];
  if (write) {
    for (let attempt = 0; attempt <= MAX_REWRITES; attempt++) {
      try {
        const d = parseBroadcastDraft(await write(buildBroadcastPrompt({ ...i, avoid })));
        if (!d.bubbles.length) continue;
        if (i.followupTemplate && !d.followup.length) d.followup = fillTemplate(i.followupTemplate, { first_name: firstNameOf(i.contact.fullName, i.contact.username) });
        if (!i.followupTemplate) d.followup = [];
        const text = messageText(d.bubbles, d.followup);
        if (!isNearDuplicateOfAny(text, taken)) return finish(d);
        avoid = [...avoid, text].slice(-12);
      } catch {
        break;
      }
    }
  }
  for (let v = 0; v < 40; v++) {
    const d = variantDraft(i, seed + v);
    if (!isNearDuplicateOfAny(messageText(d.bubbles, d.followup), taken)) return finish(d);
  }
  // Everything near-duplicated (a huge list): make it unique by the name.
  const first = firstNameOf(i.contact.fullName, i.contact.username).toLowerCase();
  const d = variantDraft(i, seed);
  return finish({ ...d, bubbles: [`${d.bubbles[0]}${d.bubbles[0].includes(first) ? "" : `, ${first}`}`, ...d.bubbles.slice(1)] });
}

// ---------------------------------------------------------------- 5 variations

/** The prompt for "5 variations": J writes the text bubbles 5 ways, once. */
export function buildVariationsPrompt(i: { texts: string[]; name: string; count: number }): string {
  return [
    `DRAFT KIND: broadcast variations`,
    `BROADCAST: ${i.name}. Kevin is sending this to a list; people are spread across your versions.`,
    `Write ${i.count} versions of Kevin's message below, each in his voice, same meaning and length, clearly different wording.`,
    `Keep {first_name} where a name goes. Never add a link (links are sent on their own). No pitch, no call ask.`,
    `Each version has exactly ${i.texts.length} bubble${i.texts.length === 1 ? "" : "s"}, matching Kevin's bubbles one for one.`,
    ``,
    `KEVIN'S BUBBLES:`,
    ...i.texts.map((t, n) => `${n + 1}. ${t}`),
    ``,
    `Return JSON only: {"variations": [["bubble 1", "…"], …]}`,
  ].join("\n");
}

/** Parse the model's variations; drops empties and links. */
export function parseVariationsDraft(obj: unknown, count: number): string[][] {
  const o = (obj && typeof obj === "object" ? obj : {}) as Record<string, unknown>;
  const list = Array.isArray(o.variations) ? o.variations : [];
  return list
    .map((v) => (Array.isArray(v) ? v : typeof v === "string" ? splitLines(v) : []).filter((x): x is string => typeof x === "string").map(stripLinks).filter(Boolean))
    .filter((v) => v.length)
    .slice(0, count);
}

const VARIATION_OPENERS = ["", "hey {first_name}! ", "{first_name}, ", "yo {first_name}, ", "hi {first_name}, "];

/** The deterministic 5 (no model, or the model fell short): Kevin's words, then small opener changes. */
export function fallbackVariations(texts: string[], count: number): string[][] {
  const out: string[][] = [];
  for (let v = 0; v < count; v++) {
    if (v === 0 || !texts.length) {
      out.push([...texts]);
      continue;
    }
    const [head, ...rest] = texts;
    const bare = head.replace(/^(hey|hi|yo)\s+\{first_name\}[,!]?\s*/i, "").replace(/^\{first_name\}[,!]?\s*/i, "");
    out.push([`${VARIATION_OPENERS[v % VARIATION_OPENERS.length]}${bare}`.trim(), ...rest]);
  }
  return out;
}

/** J writes the variations once; any shortfall is filled by the fallback. Never throws. */
export async function writeVariations(texts: string[], name: string, write: DraftWriter | null, count: number): Promise<string[][]> {
  const fallback = fallbackVariations(texts, count);
  if (!write || !texts.length) return fallback;
  try {
    const got = parseVariationsDraft(await write(buildVariationsPrompt({ texts, name, count })), count);
    return [...got, ...fallback.slice(got.length)].slice(0, count);
  } catch {
    return fallback;
  }
}
