// A voice correction as plain lines for the helper panel and the Voice
// corrections cards: what J drafted, what went out, and why. Reads every
// format the log has used. Pure.

import type { VoiceCorrection } from "@/lib/os/setter/profile";

export interface CorrectionPair {
  wrote: string;
  sent: string;
  /** "@handle" or a date, when the title says. */
  who: string;
  /** The reason, when the entry gives one ("why:", "note:", "Kevin's reasoning:"). */
  why: string;
}

const unquote = (t: string) =>
  t
    .split("\n")
    .map((l) => l.replace(/^\s*>\s?/, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/^['"‘“]|['"’”]$/g, "")
    .trim();

function after(body: string, labels: RegExp, stop: RegExp, clean: (t: string) => string = unquote): string {
  const m = labels.exec(body);
  if (!m) return "";
  const rest = body.slice(m.index + m[0].length);
  const end = rest.search(stop);
  return clean(end === -1 ? rest : rest.slice(0, end));
}

/** A bold label bullet ("- **why:** …") ends a quoted block too. */
const BULLET = String.raw`[-*]\s+\*\*[^*]+\*\*`;
const oneLine = (t: string) => t.replace(/\s+/g, " ").replace(/^[-*]\s*/, "").trim();

export function correctionPair(c: VoiceCorrection): CorrectionPair {
  const b = c.body ?? "";
  const stop = new RegExp(String.raw`\n\s*(\*\*[^*]+:\*\*|${BULLET}|[-*]?\s*(my version|note|kevin sent|sent instead|rules extracted|why)\b)`, "i");
  const wrote = after(b, /(\*\*(J drafted|J recommended|Rejected)[^*]*:\*\*|you wrote:)/i, stop);
  const sent = after(b, /(\*\*(Kevin sent|Kevin kept|Sent instead|Chosen)[^*]*:\*\*|my version:)/i, new RegExp(String.raw`\n\s*(\*\*[^*]+:\*\*|${BULLET}|[-*]?\s*(note|rules extracted|why)\b)`, "i"));
  const handle = /@[\w.]+/.exec(c.title)?.[0];
  const date = /\d{4}-\d{2}-\d{2}/.exec(c.title)?.[0];
  const why = after(
    b,
    /(\*\*why:?\*\*:?|\*\*(Kevin's )?reasoning[^*]*\*\*:?|\*\*rules extracted:?\*\*:?|^\s*note:)/im,
    new RegExp(String.raw`\n\s*(\*\*[^*]+:\*\*|${BULLET})`, "i"),
    oneLine
  ).replace(/^_?\(pending distill\)_?$/i, "");
  return { wrote, sent: sent || (wrote ? "" : c.title), who: handle ?? date ?? "", why };
}

const quote = (t: string) =>
  t
    .trim()
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");

/** The markdown a hand-added correction is stored as (what correctionPair reads). */
export function correctionBody(d: { wrote: string; sent: string; why: string }): string {
  return `**J drafted:**\n\n${quote(d.wrote)}\n\n**Sent instead:**\n\n${quote(d.sent)}${d.why.trim() ? `\n\n- **why:** ${d.why.trim()}` : ""}`;
}
