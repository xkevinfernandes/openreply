export type Tone = "neutral" | "mark" | "good" | "warn" | "bad" | "ink";

// One status map for the whole OS. good = it's working or it worked,
// neutral = not running yet / off, warn = decide this, bad = it failed.
// "Draft" is never green. Unknown words are neutral.
const GOOD = new Set(["live", "active", "on", "auto", "running", "sent", "delivered", "replied", "booked", "showed", "won", "connected", "synced", "ready", "done", "published"]);
const WARN = new Set(["review", "needs review", "pending", "waiting", "decide", "approve", "expiring", "due"]);
const BAD = new Set(["failed", "error", "lost", "bounced", "blocked", "disconnected", "expired", "no-show", "no show"]);

/** The pill tone for a status word ("Draft" → neutral, "Live" → good). */
export function statusTone(status: string | null | undefined): Tone {
  const s = (status ?? "").trim().toLowerCase();
  if (GOOD.has(s)) return "good";
  if (WARN.has(s)) return "warn";
  if (BAD.has(s)) return "bad";
  return "neutral";
}

/** The shared pill's class for a tone (@claudepreneur/brand Pill: cp-pill,
 * cp-pill-good/-warn/-bad). "mark" is good; "ink" is the one picked pill. */
export function pillClass(tone: Tone = "neutral"): string {
  if (tone === "good" || tone === "mark") return "cp-pill cp-pill-good";
  if (tone === "warn") return "cp-pill cp-pill-warn";
  if (tone === "bad") return "cp-pill cp-pill-bad";
  if (tone === "ink") return "cp-pill os-pill-ink";
  return "cp-pill";
}

/** A small rounded label: stage, "Draft", "Quiet 3d". For a status word,
 * pass tone={statusTone(word)}. The shared Pill's markup, plus a title. */
export function Pill({ tone = "neutral", title, children, className }: { tone?: Tone; title?: string; children: React.ReactNode; className?: string }) {
  return (
    <span className={`${pillClass(tone)}${className ? ` ${className}` : ""}`} title={title}>
      {children}
    </span>
  );
}

/** A 6px status dot. Green = waiting on Kevin, amber = decide, red = error. */
export function Dot({ tone = "mark", label }: { tone?: Tone; label?: string }) {
  return <span className="os-dot" data-tone={tone} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}
