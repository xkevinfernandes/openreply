// Port of DM Setter/scripts/dms/file_profile.py: the per-setter knowledge
// (voice, offer, offers, funnel, examples, voice corrections) rendered into the
// BRAND CONTEXT block that is appended to the shared method. Pure: it takes
// the file contents as strings; lib/os/setter/knowledge.ts does the reading.

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

export interface FunnelStage {
  key: string;
  label: string;
  guidance: string;
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

const OFFER_KEYS = ["status", "sold_by", "price", "price_in_dms", "length", "open_from", "open_until", "doc_url", "payment_url"];

export interface Offer {
  name: string;
  notes: string;
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

/** memory/voice-corrections.md folded into the context. Most recent `limit` entries win. */
export function correctionsBlock(text: string, limit = 25): string {
  const body = stripFrontmatter(text).trim();
  if (!body) return "";
  let entries = body
    .split(/^(?=## Correction \d+)/m)
    .map((e) => e.trim())
    .filter(Boolean);
  if (entries.length > limit) entries = entries.slice(-limit);
  const joined = entries.join("\n\n");
  if (!/^(- you wrote:|## Correction|\*\*J drafted:\*\*)/m.test(joined)) return "";
  return (
    "VOICE CORRECTIONS — replies you drafted before that Kevin rewrote before sending. " +
    "Internalize the PATTERN (tone, length, word choice, how they open and react); " +
    "the rewritten version is always the target voice:\n" +
    joined
  );
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
    if (o.notes) lines.push("- " + o.notes.replace(/\n/g, "\n  "));
  }
  if (closed.length) lines.push("Not open today — NEVER mention, hint at, or invite to: " + closed.map((o) => o.name).join(", "));
  return lines.join("\n") + "\n";
}

/** The BRAND CONTEXT text appended to the method at runtime. */
export function renderBrandBlock(k: KnowledgeFiles, catalogRows: CatalogRow[], today: string): string {
  const settings = k.settings ?? {};
  const [voice, voiceExamples] = parseVoice(k.voice);
  const stages = parseFunnel(k.funnel);
  const pb = parsePlaybook(k.playbook);
  const { sections: offer, objections } = parseOffer(k.offer);
  const offerList = parseOffers(k.offers);
  const threads = stripFrontmatter(k.conversationExamples).trim();
  const examples = threads ? (voiceExamples ? `${voiceExamples}\n\n${threads}`.trim() : threads) : voiceExamples;
  const audience = (settings.audience || "b2b").toLowerCase();
  const objectionPlaybook = objections.length ? objections : pb.objection_playbook;
  const calUrl = offer.booking_link || settings.cal_com_url || "";
  const unknown = "unknown — do NOT claim or invent anything here";
  const val = (key: string, fallback = "") => offer[key] || fallback || unknown;

  const out: string[] = [
    "## BRAND CONTEXT (supplied at runtime — this is the account you are writing for)",
    `- **Account:** @${settings.ig_username || "?"}`,
    `- **Operator:** ${settings.operator || "the account owner"} (first person — you ARE the operator)`,
    `- **Active setter profile:** ${k.setterName}`,
    `- **AUDIENCE: ${audience.toUpperCase()}** — apply the ${audience.toUpperCase()} frame rules from the method`,
    "",
  ];
  out.push(section("Offer", val("offer", pb.offer_summary)));
  out.push(section("Outcome they buy", val("outcome")));
  out.push(section("Price / how it's discussed", val("price", "never quote a price in DMs; it depends, that is what the call is for")));
  out.push(section("Mechanism", val("mechanism")));
  out.push(section("What it is NOT", val("what_it_is_not")));
  out.push(section("Guarantee", val("guarantee", "none stated — never promise one")));
  out.push(section("ICP (who we serve)", val("icp", pb.icp_description)));
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
  if (offerList.length) out.push(renderOffers(offerList, today));
  out.push(section("Booking link (the ONLY link you send at the bridge)", calUrl || unknown));
  if (offer.voice_never_do) out.push(section("Voice — never do", offer.voice_never_do));
  if (stages.length) {
    out.push(
      "### CLIENT JOURNEY (what to ask at each stage — overrides the examples in the method)\n" +
        stages.map((s) => `**${s.label}** — ${s.guidance}`).join("\n") +
        "\n"
    );
  }
  if (voice) out.push("### VOICE (overrides the method's default voice rules)\n" + voice + "\n");
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
  const corr = correctionsBlock(k.voiceCorrections);
  if (corr) out.push(corr);
  return out.join("\n").trim();
}

/** The open offer an invitation is for: the named one if open, else the first open one. */
export function openOffer(offersMd: string, today: string, name?: string | null): Offer | null {
  const live = parseOffers(offersMd).filter((o) => offerIsOpen(o, today));
  if (name) {
    const hit = live.find((o) => o.name.toLowerCase() === String(name).toLowerCase());
    if (hit) return hit;
  }
  return live[0] ?? null;
}
