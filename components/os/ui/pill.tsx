export type Tone = "neutral" | "mark" | "warn" | "bad" | "ink";

/** A small rounded label: stage, "Draft", "Quiet 3d". */
export function Pill({ tone = "neutral", title, children }: { tone?: Tone; title?: string; children: React.ReactNode }) {
  return (
    <span className="os-pill" data-tone={tone} title={title}>
      {children}
    </span>
  );
}

/** A 6px status dot. Green = waiting on Kevin, amber = decide, red = error. */
export function Dot({ tone = "mark", label }: { tone?: Tone; label?: string }) {
  return <span className="os-dot" data-tone={tone} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}
