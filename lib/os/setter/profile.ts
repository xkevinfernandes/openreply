// Port of DM Setter/scripts/dms/file_profile.py: the per-setter knowledge
// (voice, offer, offers, funnel, examples, voice corrections) rendered into the
// BRAND CONTEXT block that is appended to the shared method.
//
// One shape, SetterProfile, is what a knowledge base holds. It comes from a
// Setter row (lib/os/setter/setters.ts) or, as a fallback, from the markdown
// files (profileFromFiles). Pure: no I/O here.

import type { CatalogRow } from "@/lib/os/setter/types";

export interface ClientSettings {
  id?: string;
  ig_username?: string;
  operator?: string;
  audience?: string;
  autonomy?: string;
  active_setter?: string;
  cal_com_url?: string;
  calcom_followup_hours?: number;
  allowed_emojis?: string[];
  allowed_gifs?: { label: string; url: string }[];
  escalation_rules?: { keywords?: string[] };
  [key: string]: unknown;
}

/** Everything one setter knows, as raw text (one field per markdown file). */
export interface KnowledgeFiles {
  clientId: string;
  setterName: string;
  settings: ClientSettings;
  offer: string;
  offers: string;
  voice: string;
  funnel: string;
  playbook: string;
  conversationExamples: string;
  voiceCorrections: string;
}

// ── pure parsers ─────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** [(heading, body)] for each `#{level} ` section, in order. */
export function splitSections(text: string, level = 2): [string, string][] {
  const rx = new RegExp(`^#{${level}}\\s+(.+?)\\s*$`, "gm");
  const starts: [number, string][] = [];
  for (const m of text.matchAll(rx)) starts.push([m.index ?? 0, m[1].trim()]);
  return starts.map(([pos, heading], i) => {
    const nl = text.indexOf("\n", pos);
    const bodyStart = nl === -1 ? text.length : nl + 1;
    const end = i + 1 < starts.length ? starts[i + 1][0] : text.length;
    return [heading, text.slice(bodyStart, end).trim()];
  });
}

export function parseMdTable(text: string): Record<string, string>[] {
  const rows = text.split("\n").filter((ln) => ln.trim().startsWith("|"));
  if (rows.length < 2) return [];
  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\|+|\|+$/g, "")
      .split("|")
      .map((c) => c.trim());
  const headers = cells(rows[0]).map(slugify);
  const out: Record<string, string>[] = [];
  for (const line of rows.slice(2)) {
    const vals = cells(line);
    if (!vals.some(Boolean)) continue;
    out.push(Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""])));
  }
  return out;
}

export function stripFrontmatter(text: string): string {
  if (text.trimStart().startsWith("---")) {
    const m = /^\s*---\s*\n[\s\S]*?\n---\s*\n/.exec(text);
    if (m) return text.slice(m[0].length);
  }
  return text;
}

function stripCommentLines(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

export type StageAutopilot = "approve" | "auto";
/** Clean approvals at a stage before Auto is the recommendation (lib/os/setter/autopilot.ts). */
export const CLEAN_TARGET = 20;

export interface FunnelStage {
  key: string;
  label: string;
  guidance: string;
  /** Other ways to say this stage's line, so J doesn't always say the same thing. */
  variations?: string[];
  /** Rotate the variations (A/B). Off: J only reads the guidance. */
  ab?: boolean;
  /** "auto": J's drafts at this stage send without Approve (lib/os/setter/autopilot.ts). Default approve. */
  autopilot?: StageAutopilot;
}

/** One stage line for the brand block. Without A/B variations it is exactly the old line. */
export function stageLine(s: FunnelStage): string {
  const head = `**${s.label}** — ${s.guidance}`;
  const vars = s.ab ? (s.variations ?? []).map((v) => v.trim()).filter(Boolean) : [];
  if (!vars.length) return head;
  return `${head}\n  Say it in one of these ways (rotate between them, never copy one word for word):\n${vars.map((v) => `  - ${v.replace(/\n/g, " ")}`).join("\n")}`;
}

export function parseFunnel(text: string): FunnelStage[] {
  return splitSections(stripFrontmatter(text))
    .filter(([, body]) => body.trim())
    .map(([heading, body]) => ({ key: slugify(heading), label: heading, guidance: body.trim() }));
}

export function parseVoice(text: string): [string, string] {
  const t = stripFrontmatter(text);
  const m = /^##\s+Examples\s*$/im.exec(t);
  if (!m) return [t.trim(), ""];
  const voice = t.slice(0, m.index).trim();
  const nl = t.indexOf("\n", m.index);
  const bodyStart = nl === -1 ? t.length : nl + 1;
  return [voice, t.slice(bodyStart).trim()];
}

export interface Objection {
  objection: string;
  response: string;
}

export function parsePlaybook(text: string) {
  const out = {
    icp_description: "",
    offer_summary: "",
    objection_playbook: [] as Objection[],
    lead_magnets: [] as Record<string, string>[],
    offers: [] as Record<string, string>[],
  };
  for (const [heading, body] of splitSections(stripFrontmatter(text))) {
    const h = heading.toLowerCase();
    if (h.startsWith("icp") || h.includes("who we serve")) out.icp_description = body;
    else if (h.startsWith("offer summary") || h === "offer") out.offer_summary = body;
    else if (h.startsWith("objection"))
      out.objection_playbook = splitSections(body, 3)
        .filter(([, r]) => r.trim())
        .map(([o, r]) => ({ objection: o, response: r }));
    else if (h.startsWith("resource")) out.lead_magnets = parseMdTable(body);
    else if (h.startsWith("offer")) out.offers = parseMdTable(body);
  }
  return out;
}

const OFFER_KEYS = ["status", "sold_by", "price", "price_in_dms", "length", "open_from", "open_until", "doc_url", "payment_url", "pitch", "fit_criteria"];

export interface Offer {
  name: string;
  notes: string;
  /** One or two lines J can paraphrase when inviting. */
  pitch?: string;
  /** Who this offer is right for: J uses it to pick between open offers. */
  fit_criteria?: string;
  status: string;
  sold_by: string;
  price?: string;
  price_in_dms?: string;
  length?: string;
  open_from?: string;
  open_until?: string;
  doc_url?: string;
  payment_url?: string;
}

/** offers.md → [{name, status, sold_by, price, …, notes}]. Unknown lines are notes. */
export function parseOffers(text: string): Offer[] {
  return splitSections(stripCommentLines(stripFrontmatter(text))).map(([heading, body]) => {
    const o: Record<string, string> = { name: heading, notes: "" };
    const notes: string[] = [];
    for (const ln of body.split("\n")) {
      const m = /^\s*([a-z_]+)\s*:\s*(.*)$/.exec(ln);
      if (m && OFFER_KEYS.includes(m[1])) o[m[1]] = m[2].trim();
      else if (ln.trim()) notes.push(ln.trimEnd());
    }
    o.notes = notes.join("\n").trim();
    o.status = (o.status || "draft").toLowerCase();
    o.sold_by = (o.sold_by || "call").toLowerCase();
    return o as unknown as Offer;
  });
}

/** today = YYYY-MM-DD. Open = status open AND inside open_from/open_until when set. */
export function offerIsOpen(o: Offer, today: string): boolean {
  if (o.status !== "open") return false;
  if (o.open_from && today < o.open_from) return false;
  if (o.open_until && today > o.open_until) return false;
  return true;
}

const UNFILLED = /^\s*(\(|_|<)?\s*(tbd|todo|fill me|fill in|unknown|\?+)\s*(\)|_|>)?\s*$/i;

const OFFER_ALIASES: Record<string, string> = {
  what_this_is_not: "what_it_is_not",
  who_i_do_not_serve: "who_i_dont_serve",
  who_i_don_t_serve: "who_i_dont_serve",
  never_do: "voice_never_do",
  voice_never_does: "voice_never_do",
  booking: "booking_link",
  cal_link: "booking_link",
};

/** offer.md → {section: text} plus objections. A blank or placeholder
 *  section is "" so the renderer can say "unknown, do not claim". */
export function parseOffer(text: string): { sections: Record<string, string>; objections: Objection[] } {
  const sections: Record<string, string> = {};
  let objections: Objection[] = [];
  for (const [heading, body] of splitSections(stripCommentLines(stripFrontmatter(text)))) {
    let key = slugify(heading);
    key = OFFER_ALIASES[key] ?? key;
    if (key === "objections") {
      objections = splitSections(body, 3)
        .filter(([, r]) => r.trim())
        .map(([o, r]) => ({ objection: o, response: r }));
      continue;
    }
    const b = body.trim();
    sections[key] = !b || UNFILLED.test(b) ? "" : b;
  }
  return { sections, objections };
}

/** One correction: what J drafted vs what was sent, and why (markdown). */
export interface VoiceCorrection {
  title: string;
  body: string;
}

/** memory/voice-corrections.md → entries. Each `## Correction N` block is one
 *  entry; loose bullets before the first one ("- you wrote: … my version: …")
 *  become one entry each. Comments and the explanatory blockquote are dropped. */
export function parseCorrections(text: string): VoiceCorrection[] {
  const body = stripCommentLines(stripFrontmatter(text)).trim();
  if (!body) return [];
  const chunks = body.split(/^(?=## Correction \d+)/m);
  const out: VoiceCorrection[] = [];
  for (const raw of chunks) {
    const chunk = raw.trim();
    if (!chunk) continue;
    if (chunk.startsWith("## ")) {
      const nl = chunk.indexOf("\n");
      const title = (nl === -1 ? chunk : chunk.slice(0, nl)).replace(/^##\s+/, "").trim();
      const b = (nl === -1 ? "" : chunk.slice(nl + 1))
        .replace(/\n-{3,}\s*$/, "")
        .trim();
      out.push({ title, body: b });
      continue;
    }
    // Preamble: keep only "- you wrote:" bullets (with their indented lines).
    const bullets = chunk.split(/^(?=- you wrote:)/m).filter((b) => b.startsWith("- you wrote:"));
    for (const b of bullets) {
      const lines = b.split("\n");
      const kept = [lines[0], ...lines.slice(1).filter((l) => /^\s+\S/.test(l))].join("\n").trim();
      out.push({ title: "Pinned correction", body: kept });
    }
  }
  return out;
}

export function correctionsMarkdown(entries: VoiceCorrection[]): string {
  return entries
    .filter((e) => e.body.trim())
    .map((e) => `## ${e.title.trim() || "Correction"}\n\n${e.body.trim()}`)
    .join("\n\n---\n\n");
}

/** Voice corrections folded into the context. Most recent `limit` entries win. */
export function correctionsBlock(entries: VoiceCorrection[], limit = 25): string {
  let list = entries.filter((e) => e.body.trim());
  if (!list.length) return "";
  if (list.length > limit) list = list.slice(-limit);
  return (
    "VOICE CORRECTIONS — replies you drafted before that Kevin rewrote before sending. " +
    "Internalize the PATTERN (tone, length, word choice, how they open and react); " +
    "the rewritten version is always the target voice:\n" +
    correctionsMarkdown(list)
  );
}

// ── the profile ──────────────────────────────────────────────────────────────

/** The business facts J may state, one field per offer.md section. */
export const BUSINESS_FIELDS = [
  { key: "offer", label: "Offer", hint: "What you sell, in a few lines." },
  { key: "outcome", label: "Outcome they buy", hint: "The result, in their words." },
  { key: "price", label: "Price / how it's discussed", hint: "Blank = never quote a price in DMs." },
  { key: "mechanism", label: "Mechanism", hint: "How it works." },
  { key: "what_it_is_not", label: "What it is NOT", hint: "" },
  { key: "guarantee", label: "Guarantee", hint: "Blank = none, J never promises one." },
  { key: "icp", label: "ICP (who you serve)", hint: "" },
  { key: "who_i_dont_serve", label: "Who you do NOT serve", hint: "" },
  { key: "proof", label: "Proof J may reference", hint: "Blank = J cites no numbers or client results." },
  { key: "backstory", label: "Backstory", hint: "" },
  { key: "booking_link", label: "Booking link", hint: "The only link J sends at the bridge." },
  { key: "voice_never_do", label: "Never do", hint: "Hard rules, one per line." },
] as const;

export type BusinessKey = (typeof BUSINESS_FIELDS)[number]["key"];

export interface BusinessFacts {
  sections: Partial<Record<BusinessKey | string, string>>;
  objections: Objection[];
}

/** Everything one knowledge base holds (the per-setter parts; the method is shared). */
export interface SetterProfile {
  name: string;
  settings: ClientSettings;
  business: BusinessFacts;
  offers: Offer[];
  funnel: FunnelStage[];
  /** Voice rules (voice.md above `## Examples`). */
  voice: string;
  /** Short voice examples (voice.md `## Examples`). */
  voiceExamples: string;
  /** Full example threads (conversation-examples.md). */
  examples: string;
  voiceCorrections: VoiceCorrection[];
  /** Who J is (System prompt.md above `## Voice`). Empty for imported setters. */
  persona?: string;
  /** The global custom fields this setter fills (Setup › Fields J fills). */
  fields?: FieldToFill[];
  /** Best episodes J may share, highest priority first (Resources). */
  episodes?: Episode[];
}

export interface FieldToFill {
  key: string;
  label: string;
  type: string;
}

export interface Episode {
  name: string;
  link: string;
  /** When to share it, in Kevin's words. */
  when: string;
}

/** settings.booking (Setup › Booking): how J books calls. */
export function bookingLinkOf(settings: ClientSettings | undefined): string {
  const b = settings?.booking;
  const link = b && typeof b === "object" ? (b as { link?: unknown }).link : undefined;
  return typeof link === "string" ? link.trim() : "";
}

export function fieldsBlock(fields: FieldToFill[]): string {
  if (!fields.length) return "";
  return (
    "### FIELDS TO FILL (only from what they actually said — never guess)\n" +
    fields.map((f) => `- \`${f.key}\`: ${f.label} (${f.type.toLowerCase()})`).join("\n") +
    '\nPut what you learned in the JSON as "fields": {"<key>": "<value in their words>"}. Leave a field out until they say it.\n'
  );
}

export function episodesBlock(episodes: Episode[]): string {
  const list = episodes.filter((e) => e.link.trim());
  if (!list.length) return "";
  return (
    "### BEST EPISODES (videos you may share, highest first — share at most one, only when it fits)\n" +
    list.map((e, i) => `${i + 1}. **${e.name}**: ${e.link}${e.when.trim() ? `\n   when: ${e.when.trim().replace(/\n/g, " ")}` : ""}`).join("\n") +
    "\n"
  );
}

/** The markdown files → a profile. playbook.md only fills gaps in offer.md. */
export function profileFromFiles(k: KnowledgeFiles): SetterProfile {
  const [voice, voiceExamples] = parseVoice(k.voice);
  const pb = parsePlaybook(k.playbook);
  const { sections, objections } = parseOffer(k.offer);
  if (!sections.offer && pb.offer_summary) sections.offer = pb.offer_summary;
  if (!sections.icp && pb.icp_description) sections.icp = pb.icp_description;
  return {
    name: k.setterName,
    settings: k.settings ?? {},
    business: { sections, objections: objections.length ? objections : pb.objection_playbook },
    offers: parseOffers(k.offers),
    funnel: parseFunnel(k.funnel),
    voice,
    voiceExamples,
    examples: stripFrontmatter(k.conversationExamples).trim(),
    voiceCorrections: parseCorrections(k.voiceCorrections),
  };
}

function section(title: string, body: string): string {
  return body && body.trim() ? `### ${title}\n${body.trim()}\n` : "";
}

export function renderOffers(offers: Offer[], today: string): string {
  const open: Offer[] = [];
  const closed: Offer[] = [];
  for (const o of offers) (offerIsOpen(o, today) ? open : closed).push(o);
  const lines = [`### OFFERS — what can be invited to today (${today})`];
  if (!open.length) {
    lines.push(
      "NO offer is open today. Do not invite to anything; keep the conversation going or hold. Set `invite_ready: false`."
    );
  }
  const routes: Record<string, string> = { call: "a call", doc: "the offer doc", either: "a call or the offer doc" };
  for (const o of open) {
    lines.push(`**${o.name}** — OPEN · invitation via ${routes[o.sold_by] ?? "a call"}`);
    if (o.length) lines.push(`- length: ${o.length}`);
    if (o.price) lines.push(`- price: ${o.price}`);
    if (!["yes", "true"].includes((o.price_in_dms || "no").toLowerCase())) lines.push("- price is NEVER said in DMs for this offer");
    if (o.sold_by === "doc" || o.sold_by === "either")
      lines.push(`- doc: ${o.doc_url || "NO DOC YET — doc route unavailable, use the call"}`);
    if (o.open_until) lines.push(`- closes after ${o.open_until} (limited spots — say so only if true)`);
    if (o.pitch) lines.push(`- pitch: ${o.pitch.replace(/\n/g, " ")}`);
    if (o.fit_criteria) lines.push(`- right for: ${o.fit_criteria.replace(/\n/g, " ")}`);
    if (o.notes) lines.push("- " + o.notes.replace(/\n/g, "\n  "));
  }
  if (closed.length) lines.push("Not open today — NEVER mention, hint at, or invite to: " + closed.map((o) => o.name).join(", "));
  return lines.join("\n") + "\n";
}

/** The BRAND CONTEXT text appended to the method at runtime. */
export function renderBrandBlock(p: SetterProfile, catalogRows: CatalogRow[], today: string): string {
  const settings = p.settings ?? {};
  const offer = p.business?.sections ?? {};
  const stages = p.funnel ?? [];
  const threads = (p.examples ?? "").trim();
  const voiceExamples = (p.voiceExamples ?? "").trim();
  const examples = threads ? (voiceExamples ? `${voiceExamples}\n\n${threads}`.trim() : threads) : voiceExamples;
  const audience = (settings.audience || "b2b").toLowerCase();
  const objectionPlaybook = p.business?.objections ?? [];
  const calUrl = bookingLinkOf(settings) || offer.booking_link || settings.cal_com_url || "";
  const unknown = "unknown — do NOT claim or invent anything here";
  const val = (key: string, fallback = "") => offer[key] || fallback || unknown;

  const out: string[] = [
    "## BRAND CONTEXT (supplied at runtime — this is the account you are writing for)",
    `- **Account:** @${settings.ig_username || "?"}`,
    `- **Operator:** ${settings.operator || "the account owner"} (first person — you ARE the operator)`,
    `- **Active setter profile:** ${p.name}`,
    `- **AUDIENCE: ${audience.toUpperCase()}** — apply the ${audience.toUpperCase()} frame rules from the method`,
    "",
  ];
  if (p.persona?.trim()) out.push("### WHO YOU ARE\n" + p.persona.trim() + "\n");
  out.push(section("Offer", val("offer")));
  out.push(section("Outcome they buy", val("outcome")));
  out.push(section("Price / how it's discussed", val("price", "never quote a price in DMs; it depends, that is what the call is for")));
  out.push(section("Mechanism", val("mechanism")));
  out.push(section("What it is NOT", val("what_it_is_not")));
  out.push(section("Guarantee", val("guarantee", "none stated — never promise one")));
  out.push(section("ICP (who we serve)", val("icp")));
  out.push(section("Who we do NOT serve", val("who_i_dont_serve")));
  out.push(section("Proof you may reference", val("proof", "none listed — do not cite numbers or client results")));
  out.push(section("Backstory", val("backstory")));
  if (objectionPlaybook.length) {
    out.push(
      "### Objection playbook\n" +
        objectionPlaybook.map((o) => `- **${o.objection}** → ${o.response.trim()}`).join("\n") +
        "\n"
    );
  }
  if (p.offers?.length) out.push(renderOffers(p.offers, today));
  out.push(section("Booking link (the ONLY link you send at the bridge)", calUrl || unknown));
  if (offer.voice_never_do) out.push(section("Voice — never do", offer.voice_never_do));
  if (stages.length) {
    out.push(
      "### CLIENT JOURNEY (what to ask at each stage — overrides the examples in the method)\n" +
        stages.map(stageLine).join("\n") +
        "\n"
    );
  }
  if (p.voice?.trim()) out.push("### VOICE (overrides the method's default voice rules)\n" + p.voice.trim() + "\n");
  if (examples) out.push("### VOICE EXAMPLES\n" + examples + "\n");
  if (settings.allowed_emojis?.length) out.push(`### ALLOWED EMOJIS\n${settings.allowed_emojis.join(" ")}\n`);
  const rows = catalogRows.filter((r) => r.type !== "setter" && r.status === "active");
  if (rows.length) {
    const lines = rows.map((r) => {
      const url = r.zernio?.button_url || r.resource_url || "(no link yet)";
      return `- **${r.name}** (${r.resource_kind || "resource"}, slug \`${r.slug}\`): ${url}\n  ${r.for_setter || r.blurb || ""}`;
    });
    out.push("### RESOURCES (the ONLY other links that exist — never invent one)\n" + lines.join("\n") + "\n");
  } else {
    out.push("### RESOURCES\nnone — never invent a resource or a link.\n");
  }
  const eps = episodesBlock(p.episodes ?? []);
  if (eps) out.push(eps);
  const flds = fieldsBlock(p.fields ?? []);
  if (flds) out.push(flds);
  const corr = correctionsBlock(p.voiceCorrections ?? []);
  if (corr) out.push(corr);
  return out.join("\n").trim();
}

