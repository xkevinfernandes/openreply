// A setter as Markdown docs (SetterDoc rows): System prompt.md, Business.md,
// Offers.md, Objections.md and Examples.md. Pure: the import from the old JSON
// columns (docsFromProfile) and the parse back (profilePartsFromDocs).
//
// The golden rule (__tests__/os/setter-docs.test.ts): JSON → docs → profile
// renders the same BRAND CONTEXT as the JSON did. Funnel, settings and voice
// corrections stay structured (Setup), and the shared method is not a doc.

import {
  splitSections,
  stripFrontmatter,
  type BusinessFacts,
  type Objection,
  type Offer,
  type SetterProfile,
} from "@/lib/os/setter/profile";

export const DOC_KEYS = ["system_prompt", "business", "offers", "objections", "examples"] as const;
export type DocKey = (typeof DOC_KEYS)[number];
export type SetterDocs = Partial<Record<DocKey, string>>;

export const DOC_FILES: Record<DocKey, { file: string; title: string; usedWhen: string }> = {
  system_prompt: {
    file: "System prompt.md",
    title: "System prompt",
    usedWhen: "Every draft. Who J is and how J texts. The setting method is shared and stays hidden.",
  },
  business: { file: "Business.md", title: "Business", usedWhen: "Every draft. Facts J may state. An empty section means J never claims it." },
  offers: { file: "Offers.md", title: "Offers", usedWhen: "When J invites. J only invites to an open offer and never names a closed one." },
  objections: { file: "Objections.md", title: "Objections", usedWhen: "When they push back. One ## per objection, the answer under it." },
  examples: { file: "Examples.md", title: "Examples", usedWhen: "Every draft. Whole threads J learns the rhythm from, never copies." },
};

export function isDocKey(k: unknown): k is DocKey {
  return typeof k === "string" && (DOC_KEYS as readonly string[]).includes(k);
}

/** Frontmatter and a leading `# Title` line go: the file name is the title. */
export function stripTitle(md: string): string {
  const t = stripFrontmatter(md ?? "").replace(/^\s*\n/, "");
  const m = /^[ \t]*#[ \t]+[^\n]*(\n|$)/.exec(t);
  return (m ? t.slice(m[0].length) : t).replace(/^\s+/, "");
}

const stripComments = (t: string) => t.replace(/<!--[\s\S]*?-->/g, "");

const snake = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const UNFILLED = /^\s*(\(|_|<)?\s*(tbd|todo|fill me|fill in|unknown|\?+)\s*(\)|_|>)?\s*$/i;

// ---------------------------------------------------------------- System prompt.md
const VOICE_H = /^##[ \t]+Voice[ \t]*$/im;
const EXAMPLES_H = /^##[ \t]+Examples[ \t]*$/im;

export function systemPromptDoc(p: Pick<SetterProfile, "voice" | "voiceExamples"> & { persona?: string }): string {
  const parts = ["# System prompt"];
  if (p.persona?.trim()) parts.push(p.persona.trim());
  parts.push("## Voice", (p.voice ?? "").trim(), "## Examples", (p.voiceExamples ?? "").trim());
  return parts.join("\n\n").trimEnd() + "\n";
}

/** persona (above `## Voice`), voice, and the short examples (`## Examples`).
 *  No `## Voice` heading: everything above Examples is voice. */
export function parseSystemPrompt(md: string): { persona: string; voice: string; voiceExamples: string } {
  const t = stripTitle(md);
  const v = VOICE_H.exec(t);
  const head = v ? t.slice(0, v.index) : "";
  const rest = v ? t.slice(v.index + v[0].length) : t;
  const e = EXAMPLES_H.exec(rest);
  return {
    persona: head.trim(),
    voice: (e ? rest.slice(0, e.index) : rest).trim(),
    voiceExamples: e ? rest.slice(e.index + e[0].length).trim() : "",
  };
}

// ---------------------------------------------------------------- Business.md
/** Doc heading per business key (the old offer.md headings). */
export const BUSINESS_HEADINGS: [string, string][] = [
  ["offer", "Offer"],
  ["outcome", "Outcome"],
  ["price", "Price"],
  ["mechanism", "Mechanism"],
  ["what_it_is_not", "What it is NOT"],
  ["guarantee", "Guarantee"],
  ["icp", "ICP"],
  ["who_i_dont_serve", "Who I don't serve"],
  ["proof", "Proof"],
  ["backstory", "Backstory"],
  ["booking_link", "Booking link"],
  ["voice_never_do", "Never do"],
];

const BUSINESS_ALIASES: Record<string, string> = {
  outcome_they_buy: "outcome",
  price_how_it_s_discussed: "price",
  what_this_is_not: "what_it_is_not",
  icp_who_you_serve: "icp",
  who_we_serve: "icp",
  who_you_serve: "icp",
  who_i_do_not_serve: "who_i_dont_serve",
  who_i_don_t_serve: "who_i_dont_serve",
  who_you_do_not_serve: "who_i_dont_serve",
  who_we_do_not_serve: "who_i_dont_serve",
  proof_j_may_reference: "proof",
  never_do: "voice_never_do",
  voice_never_does: "voice_never_do",
  booking: "booking_link",
  cal_link: "booking_link",
};

export function businessKey(heading: string): string {
  const k = snake(heading);
  return BUSINESS_ALIASES[k] ?? k;
}

function headingFor(key: string): string {
  const known = BUSINESS_HEADINGS.find(([k]) => k === key);
  if (known) return known[1];
  const words = key.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function businessDoc(sections: BusinessFacts["sections"]): string {
  const keys = [...BUSINESS_HEADINGS.map(([k]) => k), ...Object.keys(sections).filter((k) => !BUSINESS_HEADINGS.some(([b]) => b === k))];
  const out = ["# Business"];
  for (const k of keys) {
    const body = (sections[k] ?? "").trim();
    out.push(body ? `## ${headingFor(k)}\n\n${body}` : `## ${headingFor(k)}`);
  }
  return out.join("\n\n") + "\n";
}

/** A blank or "tbd" section is "" so J says "unknown, do not claim". */
export function parseBusinessDoc(md: string): Record<string, string> {
  const sections: Record<string, string> = {};
  for (const [heading, body] of splitSections(stripComments(stripTitle(md)))) {
    const b = body.trim();
    sections[businessKey(heading)] = !b || UNFILLED.test(b) ? "" : b;
  }
  return sections;
}

// ---------------------------------------------------------------- Objections.md
export function objectionsDoc(list: Objection[]): string {
  return ["# Objections", ...list.map((o) => `## ${o.objection.trim()}\n\n${o.response.trim()}`)].join("\n\n") + "\n";
}

export function parseObjectionsDoc(md: string): Objection[] {
  return splitSections(stripComments(stripTitle(md)))
    .filter(([o, r]) => o.trim() && r.trim())
    .map(([objection, response]) => ({ objection, response }));
}

// ---------------------------------------------------------------- Offers.md
type OfferKey = "status" | "sold_by" | "price" | "price_in_dms" | "length" | "open_from" | "open_until" | "doc_url" | "payment_url" | "pitch" | "fit_criteria";

/** Canonical label written per key, in order. */
export const OFFER_LABELS: [OfferKey, string][] = [
  ["status", "Status"],
  ["sold_by", "Sold by"],
  ["price", "Price"],
  ["price_in_dms", "Price in DMs"],
  ["length", "Length"],
  ["open_from", "Open from"],
  ["open_until", "Open until"],
  ["doc_url", "Doc"],
  ["payment_url", "Payment link"],
  ["pitch", "Pitch"],
  ["fit_criteria", "Fit"],
];

/** Lenient: every spelling people type for a key. */
const OFFER_ALIASES: Record<string, OfferKey> = {
  status: "status",
  "sold by": "sold_by",
  "sold via": "sold_by",
  route: "sold_by",
  price: "price",
  "price in dms": "price_in_dms",
  "price in dm": "price_in_dms",
  "price in the dms": "price_in_dms",
  length: "length",
  duration: "length",
  "open from": "open_from",
  opens: "open_from",
  "open until": "open_until",
  closes: "open_until",
  until: "open_until",
  doc: "doc_url",
  "doc url": "doc_url",
  "offer doc": "doc_url",
  "payment url": "payment_url",
  "payment link": "payment_url",
  checkout: "payment_url",
  pitch: "pitch",
  fit: "fit_criteria",
  "fit criteria": "fit_criteria",
  "right for": "fit_criteria",
};

const LABEL_ALT = Object.keys(OFFER_ALIASES)
  .sort((a, b) => b.length - a.length)
  .map((k) => k.replace(/ /g, "[ _]+"))
  .join("|");
/** `Status: open. Sold by: call.` on one line splits before each known label. */
const SENTENCE_SPLIT = new RegExp(`\\.\\s+(?=(?:${LABEL_ALT})\\s*:)`, "i");

const ENUM_KEYS = new Set<OfferKey>(["status", "sold_by", "price_in_dms"]);

function offerKeyLine(raw: string): [OfferKey, string] | null {
  const ln = raw.replace(/\*\*/g, "").replace(/^\s*(?:[-*+]\s+)?/, "");
  const m = /^([A-Za-z][A-Za-z _]{0,24}?)\s*:\s*(.*)$/.exec(ln);
  if (!m) return null;
  const key = OFFER_ALIASES[m[1].toLowerCase().replace(/[_\s]+/g, " ").trim()];
  return key ? [key, m[2].trim()] : null;
}

function enumOf<T extends string>(v: string, allowed: readonly T[], fallback: T, alias: Record<string, T> = {}): T {
  for (const w of v.toLowerCase().match(/[a-z]+/g) ?? []) {
    if ((allowed as readonly string[]).includes(w)) return w as T;
    if (alias[w]) return alias[w];
  }
  return fallback;
}

export function parseOffersDoc(md: string): Offer[] {
  return splitSections(stripComments(stripTitle(md))).map(([name, body]) => {
    const o: Record<string, string> = {};
    const notes: string[] = [];
    for (const ln of body.split("\n")) {
      const first = offerKeyLine(ln);
      if (!first) {
        if (ln.trim()) notes.push(ln.trimEnd());
        continue;
      }
      for (const seg of ln.split(SENTENCE_SPLIT)) {
        const kv = offerKeyLine(seg);
        if (kv && ENUM_KEYS.has(kv[0]) && /\.\s+\S/.test(kv[1])) {
          // "Sold by: call. We build it together." — the rest is a note.
          const cut = kv[1].search(/\.\s+\S/);
          o[kv[0]] = kv[1].slice(0, cut);
          notes.push(kv[1].slice(cut + 1).trim());
        } else if (kv) o[kv[0]] = kv[1];
        else if (seg.trim()) notes.push(seg.trim());
      }
    }
    return {
      ...o,
      name,
      notes: notes.join("\n").trim(),
      status: enumOf(o.status ?? "", ["open", "closed", "draft"] as const, "draft", { live: "open", paused: "closed" }),
      sold_by: enumOf(o.sold_by ?? "", ["call", "doc", "either"] as const, "call", { both: "either" }),
      ...(o.price_in_dms !== undefined ? { price_in_dms: enumOf(o.price_in_dms, ["yes", "no"] as const, "no", { never: "no", true: "yes", false: "no" }) } : {}),
    } as Offer;
  });
}

export function offersDoc(offers: Offer[]): string {
  const out = ["# Offers"];
  for (const o of offers) {
    const lines = OFFER_LABELS.filter(([k]) => o[k]).map(([k, label]) => `${label}: ${String(o[k]).replace(/\s*\n\s*/g, " ")}`);
    out.push(`## ${o.name.trim()}\n\n${lines.join("\n")}${o.notes?.trim() ? `\n\n${o.notes.trim()}` : ""}`);
  }
  return out.join("\n\n") + "\n";
}

// ---------------------------------------------------------------- Examples.md
export function examplesDoc(examples: string): string {
  return `# Examples\n\n${(examples ?? "").trim()}`.trimEnd() + "\n";
}

export function parseExamplesDoc(md: string): string {
  return stripTitle(md).trim();
}

// ---------------------------------------------------------------- both ways
/** The import: the JSON columns as docs. */
export function docsFromProfile(p: SetterProfile): Record<DocKey, string> {
  return {
    system_prompt: systemPromptDoc(p),
    business: businessDoc(p.business?.sections ?? {}),
    offers: offersDoc(p.offers ?? []),
    objections: objectionsDoc(p.business?.objections ?? []),
    examples: examplesDoc(p.examples ?? ""),
  };
}

export interface ProfileParts {
  persona?: string;
  voice?: string;
  voiceExamples?: string;
  sections?: Record<string, string>;
  objections?: Objection[];
  offers?: Offer[];
  examples?: string;
}

/** What the docs that exist say. A missing doc leaves its part to the JSON. */
export function profilePartsFromDocs(docs: SetterDocs): ProfileParts {
  const out: ProfileParts = {};
  if (typeof docs.system_prompt === "string") Object.assign(out, parseSystemPrompt(docs.system_prompt));
  if (typeof docs.business === "string") out.sections = parseBusinessDoc(docs.business);
  if (typeof docs.objections === "string") out.objections = parseObjectionsDoc(docs.objections);
  if (typeof docs.offers === "string") out.offers = parseOffersDoc(docs.offers);
  if (typeof docs.examples === "string") out.examples = parseExamplesDoc(docs.examples);
  return out;
}

/** The small number next to a file in the tree. */
export function docCount(key: DocKey, body: string): number | null {
  if (key === "system_prompt" || key === "business") return null;
  return splitSections(stripComments(stripTitle(body))).filter(([h]) => h.trim()).length;
}
