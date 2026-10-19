// "New setter": seven short questions. The answers become the starter docs
// (generate.ts). Pure, shared by the page and the server.

export const QUESTION_KEYS = ["persona", "audience", "offers", "fit", "resources", "booking", "voice"] as const;
export type QuestionKey = (typeof QUESTION_KEYS)[number];
export type Answers = Partial<Record<QuestionKey, string>> & { name?: string };

export const QUESTIONS: { key: QuestionKey; q: string; hint: string }[] = [
  { key: "persona", q: "Who's texting?", hint: "Name, who you are, one line of backstory" },
  { key: "audience", q: "Who DMs you?", hint: "Who they are, what they want" },
  { key: "offers", q: "What do you sell?", hint: "One per line: name, price, call or doc" },
  { key: "fit", q: "Who's a good fit? Who isn't?", hint: "e.g. owners doing 5k+/mo · not beginners" },
  { key: "resources", q: "Lead magnets?", hint: "One per line: name + link" },
  { key: "booking", q: "How do they book?", hint: "A booking link, or “propose times”" },
  { key: "voice", q: "How do you text?", hint: "Words you use, words you never use, emojis" },
];

export const MAX_ANSWER = 4000;

export function cleanAnswers(raw: unknown): Answers {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Answers = {};
  for (const k of [...QUESTION_KEYS, "name"] as const) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, k === "name" ? 80 : MAX_ANSWER);
  }
  return out;
}

export function answered(a: Answers): number {
  return QUESTION_KEYS.filter((k) => a[k]?.trim()).length;
}

export interface LeadMagnetLine {
  name: string;
  link: string | null;
}

/** "Free guide https://x.co/g" per line → name + link. */
export function leadMagnetLines(text: string | undefined): LeadMagnetLine[] {
  return (text ?? "")
    .split("\n")
    .map((l) => l.replace(/^\s*[-*•\d.)]+\s*/, "").trim())
    .filter(Boolean)
    .map((l) => {
      const raw = /https?:\/\/\S+/i.exec(l)?.[0] ?? null;
      const url = raw?.replace(/[).,]+$/, "") ?? null;
      const name = (raw ? l.replace(raw, "") : l).replace(/[\s:–—.,-]+$/, "").replace(/^[\s:–—-]+/, "").trim();
      return { name: (name || url || "").slice(0, 160), link: url };
    })
    .filter((r) => r.name)
    .slice(0, 12);
}

export function bookingLinkIn(text: string | undefined): string | null {
  return /https?:\/\/\S+/i.exec(text ?? "")?.[0]?.replace(/[).,]+$/, "") ?? null;
}
