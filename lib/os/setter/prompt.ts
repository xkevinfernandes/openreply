// What J reads: the system prompt (shared method + this setter's BRAND
// CONTEXT) and the per-draft user prompt. Ported from setter_local.py
// (agent_system_prompt, build_prompt, bubbles_of, is_invitation).

import { renderBrandBlock, type KnowledgeFiles } from "@/lib/os/setter/profile";
import { contextBlock, entryBlock, getRow, resolve } from "@/lib/os/setter/resources";
import { parseIso, type SetterAction, type SetterRecord, type ThreadMessage } from "@/lib/os/setter/state";
import type { Catalog } from "@/lib/os/setter/types";

export function systemPrompt(method: string, knowledge: KnowledgeFiles, catalog: Catalog, today: string): string {
  let brand: string;
  try {
    brand = renderBrandBlock(knowledge, catalog.resources, today);
  } catch (err) {
    brand = `(BRAND CONTEXT unavailable: ${err instanceof Error ? err.message : String(err)}. Do not invent offer details or links.)`;
  }
  return `${method}\n\n---\n\n${brand}`;
}

export const KIND_BRIEF: Record<string, string> = {
  reply: "Draft the NEXT reply only.",
  value_opener:
    "They received the resource below {ago} and have not said anything yet. " +
    "Write the message that STARTS the conversation: one light, specific reference to " +
    "the resource (no summary of it), then one genuine question about what they are " +
    "building or working on. No pitch, no link, 1-2 bubbles.",
  nudge:
    "We wrote last, {ago}, and they went quiet. ONE bubble, zero pressure, no guilt, " +
    "no repeat of the earlier question — a light door-opener a friend would send. " +
    "If nothing natural exists, a single pressure-remover is fine.",
  friday:
    "Follow-up Friday. One warm, specific line that references your last exchange, " +
    "then hand them the resource below as a gift. No ask, no call, no pitch. 1-2 bubbles.",
};

export function windowLine(rec: SetterRecord): string {
  const st = rec.window?.state ?? "closed";
  const until = (rec.window?.until ?? "").slice(0, 16).replace("T", " ");
  return `window: ${st}` + (until ? ` until ${until} UTC` : "");
}

export function ago(ts: string | null | undefined, now: Date): string {
  const dt = parseIso(ts);
  if (!dt) return "a while ago";
  const mins = Math.floor((now.getTime() - dt.getTime()) / 60_000);
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

export function tagOptions(catalog: Catalog): string[] {
  return catalog.tag_options?.length ? catalog.tag_options : ["qualified", "friday", "not_now", "client", "booked"];
}

export function buildPrompt(
  rec: SetterRecord,
  msgs: ThreadMessage[],
  action: SetterAction,
  catalog: Catalog,
  now: Date
): string {
  const kind = action.kind;
  const lines = msgs.filter((m) => (m.text ?? "").trim()).map((m) => `${m.incoming ? "THEM" : "YOU"}: ${m.text}`);
  const entry = rec.entry;
  const hits = resolve(
    msgs.map((m) => m.text),
    catalog.resources
  );
  const entryRow = getRow(entry?.slug, catalog.resources);
  if (entryRow && !hits.includes(entryRow)) hits.push(entryRow);
  const brief = contextBlock(hits.filter((h) => h.type !== "setter"));
  const pathBlock = entry?.via === "setter_comment" ? entryBlock(entry.slug, catalog.resources) : "";
  const ref = kind === "value_opener" ? rec.delivered_at : rec.our_last_at;
  const parts = [
    `Conversation with @${rec.handle} on Instagram.`,
    `DRAFT KIND: ${kind}`,
    (KIND_BRIEF[kind] ?? KIND_BRIEF.reply).replace("{ago}", ago(ref, now)),
    `How they arrived: ${entry?.via || "unknown"}` +
      (entry?.keyword ? ` (keyword '${entry.keyword}')` : "") +
      `. Current state: ${rec.state}. ${windowLine(rec)}.`,
  ];
  const inv = rec.invited;
  if (inv) {
    parts.push(
      `ALREADY INVITED on ${(inv.at ?? "").slice(0, 10)} via ${inv.route} (${inv.offer || "offer"}). ` +
        "Do NOT invite again, do not re-ask for the call. Answer what they say; if they said yes, move to Stage 6."
    );
  }
  if (action.human_agent) {
    parts.push(
      "NOTE: this will be sent under Meta's HUMAN_AGENT tag (they last wrote over 24h ago). " +
        "Keep it short and personal; it must read like a human catching up."
    );
  }
  if (pathBlock) parts.push(pathBlock);
  if (brief) parts.push(brief);
  parts.push(
    `The WHOLE conversation so far (${lines.length} messages), oldest first — use all of it, ` +
      "especially what they told you early on:\n" +
      (lines.length ? lines.join("\n") : "(they have not written anything yet)")
  );
  parts.push(
    "Respond with STRICT JSON only:\n" +
      '{"bubbles": ["..."], "stage_proposed": "opener|value|permission|qualify|bridge|booked", ' +
      '"stage_reasoning": "...", "template_used": "...", ' +
      '"qualification": {"is_owner": null, "niche": null, "monthly_revenue": null, "pain": null, ' +
      '"tried_before": null, "fit_score": 0, "fast_track_signal": null}, ' +
      '"propose_tags": {"<tag>": "<one-line reason>"}, ' +
      '"invite_ready": false, "invite": null, "doc_bubbles": [], ' +
      '"hold": false, "hold_reason": null, "notes": "..."}\n' +
      `propose_tags may only use: ${tagOptions(catalog).join(", ")}. Propose \`qualified\` when fit_score >= 3, ` +
      "`friday` when they are worth a weekly gift, `not_now` when this is not a sales conversation, " +
      "`client`/`booked` only when the transcript says so. Empty object when nothing applies.\n" +
      "INVITATION (Stage 5): set invite_ready true ONLY when you can quote their goal and their challenge " +
      "from the transcript in THEIR words (invite.their_goal, invite.their_challenge). If either is missing, " +
      "ask for it instead (one question). Never invent an answer. invite.in_the_way = what's made it hard " +
      "so far, only if they said it, else null. Never ask what they tried or spent as a menu. " +
      'invite = {"offer": "<OPEN offer name>", "route_suggestion": "call|doc|voice", "why_fit": "...", ' +
      '"their_goal": "...", "their_challenge": "...", "in_the_way": "... or null"}. ' +
      "Kevin is pinged and picks the route, so write the call version in bubbles and the doc version in " +
      "doc_bubbles when the offer is sold by doc. hold=true with bubbles [] means send nothing."
  );
  return parts.join("\n\n");
}

// ---------------------------------------------------------------- reading the reply
export interface DraftObject {
  bubbles?: unknown;
  stage_proposed?: string;
  stage?: string;
  stage_reasoning?: string;
  reasoning?: string;
  template_used?: string;
  qualification?: { fit_score?: number | null } | null;
  propose_tags?: Record<string, unknown> | null;
  invite_ready?: boolean;
  invite?: Record<string, unknown> | null;
  doc_bubbles?: unknown[];
  hold?: boolean;
  hold_reason?: string | null;
  notes?: string;
  [key: string]: unknown;
}

export function bubblesOf(obj: DraftObject): string[] {
  for (const key of ["bubbles", "bubble", "reply", "messages"]) {
    const v = obj[key];
    if (Array.isArray(v)) {
      return v
        .map((x) => String(x && typeof x === "object" && "text" in x ? (x as { text: unknown }).text : x).trim())
        .filter(Boolean);
    }
    if (typeof v === "string" && v.trim()) return [v.trim()];
  }
  return [];
}

/** The model's flag, with a backstop: a bridge-stage draft before any
 *  invitation was sent is an invitation, so Kevin always picks the route. */
export function isInvitation(obj: DraftObject, rec: SetterRecord): boolean {
  if (rec.invited) return false;
  return Boolean(obj.invite_ready) || ["bridge", "invite", "invitation"].includes(String(obj.stage_proposed ?? "").toLowerCase());
}

export function missingQualifiers(invite: Record<string, unknown> | null | undefined): string[] {
  const inv = invite ?? {};
  return (
    [
      ["their_goal", "goal"],
      ["their_challenge", "challenge"],
    ] as const
  )
    .filter(([key]) => !String(inv[key] ?? "").trim())
    .map(([, label]) => label);
}

/** "price" if a bubble names a price or payment: those always need a careful
 *  look (spec item 9). Pure heuristic. */
export function mentionsPrice(bubbles: string[]): boolean {
  return bubbles.some((b) => /[$€£]\s?\d|\d\s?(k|usd|eur|euros?|dollars?)\b|\bprice\b|\bpay(ment)?\b|\bcosts?\b/i.test(b));
}
