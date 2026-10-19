// The numbers under the opener table. Booked per send is the metric that
// matters (research §2); small samples are hypotheses, so the table says so.

/** Wilson score interval for k successes in n trials (95% by default). */
export function wilson(k: number, n: number, z = 1.96): { low: number; high: number; rate: number } {
  if (n <= 0) return { low: 0, high: 0, rate: 0 };
  const p = Math.min(Math.max(k / n, 0), 1);
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half), rate: p };
}

export const rate = (k: number, n: number) => (n > 0 ? k / n : 0);

export interface ArmResult {
  id: string;
  label: string;
  sent: number;
  booked: number;
}

export type Verdict =
  | { kind: "empty"; text: string }
  | { kind: "too_early"; text: string; needed: number }
  | { kind: "leader"; text: string; leaderId: string }
  | { kind: "no_clear_winner"; text: string; leaderId: string | null };

/** A plain-words hint: too early until every arm has `minSends` sends; then
 *  a leader only when its interval clears every other arm's. */
export function verdict(arms: ArmResult[], minSends: number): Verdict {
  if (arms.length < 2) return { kind: "empty", text: "Add a second variant to compare." };
  const fewest = Math.min(...arms.map((a) => a.sent));
  if (fewest < minSends) {
    const needed = minSends - fewest;
    return { kind: "too_early", needed, text: `Too early. Each variant needs ${minSends} sends; the smallest is ${needed} short.` };
  }
  const scored = arms.map((a) => ({ a, ci: wilson(a.booked, a.sent) })).sort((x, y) => y.ci.rate - x.ci.rate);
  const [top, ...rest] = scored;
  if (top.ci.rate === 0) return { kind: "no_clear_winner", leaderId: null, text: "No bookings yet on any variant. Keep it running." };
  if (rest.every((r) => top.ci.low > r.ci.high)) {
    return { kind: "leader", leaderId: top.a.id, text: `${top.a.label} books more per send, and the gap is bigger than the noise.` };
  }
  return {
    kind: "no_clear_winner",
    leaderId: top.a.id,
    text: `${top.a.label} is ahead, but the ranges still overlap. Treat it as a hunch for now.`,
  };
}

export function pct(x: number): string {
  if (!Number.isFinite(x) || x <= 0) return "0%";
  const v = x * 100;
  return `${v >= 10 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}%`;
}
