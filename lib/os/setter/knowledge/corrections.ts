// A voice correction as two lines for the helper panel: what J drafted (struck
// through) and what went out. Reads every format the log has used. Pure.

import type { VoiceCorrection } from "@/lib/os/setter/profile";

export interface CorrectionPair {
  wrote: string;
  sent: string;
  /** "@handle" or a date, when the title says. */
  who: string;
}

const unquote = (t: string) =>
  t
    .split("\n")
    .map((l) => l.replace(/^\s*>\s?/, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/^['"‘“]|['"’”]$/g, "")
    .trim();

function after(body: string, labels: RegExp, stop: RegExp): string {
  const m = labels.exec(body);
  if (!m) return "";
  const rest = body.slice(m.index + m[0].length);
  const end = rest.search(stop);
  return unquote(end === -1 ? rest : rest.slice(0, end));
}

export function correctionPair(c: VoiceCorrection): CorrectionPair {
  const b = c.body ?? "";
  const stop = /\n\s*(\*\*[^*]+:\*\*|[-*]?\s*(my version|note|kevin sent|sent instead|rules extracted|why)\b)/i;
  const wrote = after(b, /(\*\*(J drafted|Rejected)[^*]*:\*\*|you wrote:)/i, stop);
  const sent = after(b, /(\*\*(Kevin sent|Sent instead|Chosen)[^*]*:\*\*|my version:)/i, /\n\s*(\*\*[^*]+:\*\*|[-*]?\s*(note|rules extracted|why)\b)/i);
  const handle = /@[\w.]+/.exec(c.title)?.[0];
  const date = /\d{4}-\d{2}-\d{2}/.exec(c.title)?.[0];
  return { wrote, sent: sent || (wrote ? "" : c.title), who: handle ?? date ?? "" };
}
