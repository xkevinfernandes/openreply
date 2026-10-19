// "Did Kevin keep the line?" When a draft carrying a variant is edited before
// sending, a heavy rewrite is recorded as edited (still attributed: the
// contact got the variant's moment, just not its words).

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9'\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Share of the variant's words that survive, in order (LCS / variant length). */
export function lineKept(variantText: string, sent: string): number {
  const a = tokens(variantText);
  const b = tokens(sent);
  if (!a.length) return 1;
  if (!b.length) return 0;
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[b.length] / a.length;
}

/** Under this share of the variant's words kept = edited heavily. */
export const KEPT_THRESHOLD = 0.6;

export function editedHeavily(variantText: string, sentBubbles: string[]): boolean {
  return lineKept(variantText, sentBubbles.join(" ")) < KEPT_THRESHOLD;
}

/** The model forgot to report the line: it's "used" when most of it is there. */
export function lineUsed(variantText: string, bubbles: string[]): boolean {
  return lineKept(variantText, bubbles.join(" ")) >= KEPT_THRESHOLD;
}
