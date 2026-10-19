// "New setter": the seven answers → starter docs (System prompt.md,
// Business.md, Offers.md, Objections.md, Examples.md) + funnel defaults, with
// the same drafter backends as J's drafts. The shared method steers the
// writing but never goes into a doc. Nothing is saved here: Kevin reviews the
// draft first (save.ts).

import type { DrafterSettings } from "@/lib/os/setter/config";
import { draft } from "@/lib/os/setter/drafter";
import {
  businessDoc,
  DOC_FILES,
  DOC_KEYS,
  examplesDoc,
  isDocKey,
  objectionsDoc,
  offersDoc,
  parseBusinessDoc,
  parseExamplesDoc,
  parseObjectionsDoc,
  parseOffersDoc,
  parseSystemPrompt,
  systemPromptDoc,
  type DocKey,
} from "@/lib/os/setter/knowledge/docs";
import type { FunnelStage, Offer } from "@/lib/os/setter/profile";
import { bookingLinkIn, leadMagnetLines, QUESTIONS, type Answers, type LeadMagnetLine } from "@/lib/os/setter/interview/questions";

export interface SetterDraft {
  name: string;
  docs: Record<DocKey, string>;
  funnel: FunnelStage[];
  leadMagnets: LeadMagnetLine[];
  bookingLink: string | null;
  /** Written by the fake backend (sample mode). */
  sample: boolean;
}

// ---------------------------------------------------------------- funnel
/** The method's stages with neutral guidance; Qualify carries their fit. */
export function funnelDefaults(fit?: string): FunnelStage[] {
  const stages: [string, string][] = [
    ["Open", "Answer what they actually said first. Match their energy and length. At most one light question about them. No pitch."],
    ["Value", "Get curious about what they're building or where it's stuck. React to the specific thing they said, in their words. Still no pitch."],
    ["Permission", "Only if they haven't opened up already: ask if you can ask a couple of things to see if you can help."],
    [
      "Qualify",
      `One question at a time: their main goal, the biggest thing in the way, what's made it hard to fix.${fit?.trim() ? `\nA fit looks like: ${fit.trim().replace(/\s*\n\s*/g, " ")}` : ""}`,
    ],
    ["Assure", "When goal and challenge are clear: reflect the most compelling thing in their words and say why you can help them specifically. No hype."],
    ["Invitation", "Only to an OPEN offer. Confident and casual, with a pressure-remover. Never say the price unless Offers.md allows it."],
    ["Booked", "Confirm warmly, say what to expect. Don't re-pitch."],
  ];
  return stages.map(([label, guidance]) => ({ key: label.toLowerCase(), label, guidance }));
}

/** The model's funnel, kept only for the known stages, in order. */
function funnelFrom(raw: unknown, fit?: string): FunnelStage[] {
  const base = funnelDefaults(fit);
  if (!Array.isArray(raw)) return base;
  return base.map((s) => {
    const hit = raw.find((x) => x && typeof x === "object" && String((x as { label?: unknown; key?: unknown }).label ?? (x as { key?: unknown }).key ?? "").toLowerCase().trim() === s.key);
    const g = hit && typeof (hit as { guidance?: unknown }).guidance === "string" ? (hit as { guidance: string }).guidance.trim() : "";
    return g ? { ...s, guidance: g.slice(0, 2000) } : s;
  });
}

// ---------------------------------------------------------------- docs
/** Every doc read back through J's own parsers and written canonically, so
 *  what Kevin reviews is exactly what J will read. */
export function normalizeDocs(raw: Partial<Record<DocKey, string>>, bookingLink: string | null): Record<DocKey, string> {
  const sp = parseSystemPrompt(raw.system_prompt ?? "");
  const business = parseBusinessDoc(raw.business ?? "");
  if (bookingLink && !business.booking_link) business.booking_link = bookingLink;
  return {
    system_prompt: systemPromptDoc(sp),
    business: businessDoc(business),
    offers: offersDoc(parseOffersDoc(raw.offers ?? "")),
    objections: objectionsDoc(parseObjectionsDoc(raw.objections ?? "")),
    examples: examplesDoc(parseExamplesDoc(raw.examples ?? "")),
  };
}

const PRICE = /([$€£]\s?\d[\d,.]*\s?k?|\d[\d,.]*\s?k?\s?(?:usd|eur|gbp|dollars|euros))/i;

/** Sample mode: the answers placed into the docs as written. Deterministic. */
export function fakeDocs(a: Answers): Record<DocKey, string> {
  const name = a.name?.trim() || "Setter";
  const offers: Offer[] = (a.offers ?? "")
    .split("\n")
    .map((l) => l.replace(/^\s*[-*•\d.)]+\s*/, "").trim())
    .filter(Boolean)
    .map((l) => ({
      name: l.split(/\s+[-–—,:]\s+|,\s*/)[0].trim().slice(0, 80) || l.slice(0, 80),
      status: "open",
      sold_by: /\bdoc\b/i.test(l) ? "doc" : "call",
      ...(PRICE.exec(l) ? { price: PRICE.exec(l)![1].trim() } : {}),
      notes: "",
    })) as Offer[];
  const voice = [
    a.voice?.trim(),
    "- Short messages, one thought per bubble.",
    "- Match their energy and length. Never pushy.",
  ]
    .filter(Boolean)
    .join("\n");
  const fit = a.fit?.trim() ?? "";
  const notFit = /(?:^|\n|[.;·]\s*)(?:not|isn'?t|no)\b[:\s]+([^\n]+)/i.exec(fit)?.[1]?.trim() ?? "";
  return {
    system_prompt: systemPromptDoc({ persona: a.persona?.trim() || `${name} answers the DMs.`, voice, voiceExamples: "" }),
    business: businessDoc({
      offer: offers.map((o) => o.name).join(", "),
      icp: [a.audience?.trim(), fit].filter(Boolean).join("\n\n"),
      who_i_dont_serve: notFit,
      booking_link: bookingLinkIn(a.booking) ?? "",
    }),
    offers: offersDoc(offers),
    objections: objectionsDoc([
      { objection: "I need to think about it", response: "Totally fair. Ask what they'd want to be sure of, then leave the door open." },
      { objection: "Is this a course?", response: "Say plainly what it is (see Offers.md). Never call it a course unless it is one." },
    ]),
    examples: examplesDoc(""),
  };
}

export function interviewSystem(method: string): string {
  return [
    "You write the starter knowledge for a new Instagram DM setter from a short interview. The setter follows a shared setting METHOD (below). The method stays hidden: never paste or restate it in a doc; use it to decide what each doc needs.",
    "",
    "THE METHOD:",
    method,
    "",
    "Write five Markdown docs. Exact formats:",
    "- system_prompt (System prompt.md): persona and voice ONLY. A short persona paragraph (who is texting, in first person or as a brief), then `## Voice` with bullet rules (how they text, words they use, words they never use, emojis), then `## Examples` with 4-8 short sample lines in that voice.",
    "- business (Business.md): `## ` sections, only these headings: Offer, Outcome, Price, Mechanism, What it is NOT, Guarantee, ICP, Who I don't serve, Proof, Backstory, Booking link, Never do. Leave a section EMPTY when the interview doesn't say it. Never invent proof, numbers, prices or guarantees.",
    "- offers (Offers.md): one `## Offer name` per offer, then `Label: value` lines: Status (open|closed|draft), Sold by (call|doc|either), Price, Price in DMs (yes|no), Pitch, Fit.",
    "- objections (Objections.md): 3-6 likely objections for THIS audience, `## the objection` then a short answer in the setter's voice. No pressure tactics.",
    "- examples (Examples.md): 1-2 short example threads (THEM:/YOU: lines) in this voice showing the method's pace. Mark them clearly as illustrations.",
    "Also a funnel: [{\"label\": \"Open|Value|Permission|Qualify|Assure|Invitation|Booked\", \"guidance\": \"<2-4 lines for this business>\"}]. Qualify must say what a fit looks like.",
    "",
    'Answer with JSON only: {"docs": {"system_prompt": "...", "business": "...", "offers": "...", "objections": "...", "examples": "..."}, "funnel": [...]}',
  ].join("\n");
}

export function interviewPrompt(a: Answers): string {
  return [
    `SETTER NAME: ${a.name?.trim() || "(unnamed)"}`,
    "",
    ...QUESTIONS.map((q) => `${q.q}\n${a[q.key]?.trim() || "(no answer)"}\n`),
  ].join("\n");
}

export function draftFrom(a: Answers, obj: unknown, sample: boolean): SetterDraft {
  const o = (obj && typeof obj === "object" ? obj : {}) as Record<string, unknown>;
  const rawDocs = (o.docs && typeof o.docs === "object" ? o.docs : o) as Record<string, unknown>;
  const docs: Partial<Record<DocKey, string>> = {};
  for (const [k, v] of Object.entries(rawDocs)) {
    const key = isDocKey(k) ? k : DOC_KEYS.find((d) => DOC_FILES[d].file === k);
    if (key && typeof v === "string") docs[key] = v;
  }
  const bookingLink = bookingLinkIn(a.booking);
  return {
    name: a.name?.trim() || "New setter",
    docs: normalizeDocs(docs, bookingLink),
    funnel: funnelFrom(o.funnel, a.fit),
    leadMagnets: leadMagnetLines(a.resources),
    bookingLink,
    sample,
  };
}

export async function generateSetterDraft(a: Answers, settings: DrafterSettings, method: string): Promise<SetterDraft> {
  if (settings.backend === "fake") return draftFrom(a, { docs: fakeDocs(a) }, true);
  const s: DrafterSettings = {
    ...settings,
    max_tokens: { ...settings.max_tokens, setter_build: settings.max_tokens.setter_build ?? 12000 },
    models: { ...settings.models, setter_build: settings.models.setter_build ?? settings.models.draft },
  };
  const { obj } = await draft({ system: interviewSystem(method), prompt: interviewPrompt(a), job: "setter_build", settings: s });
  return draftFrom(a, obj, false);
}
