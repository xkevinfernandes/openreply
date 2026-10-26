/** The setter's initial on an ink disc: who wrote a message (J, Nova).
 * size 16 renders as an 18px disc so the letter can sit at the 11px floor. */
export function SetterMark({ name, size = 16, title }: { name: string; size?: 16 | 20 | 24; title?: string }) {
  const label = title ?? `Sent by ${name}`;
  return (
    <span className="os-setter-mark" data-size={size} title={label} aria-label={label} role="img">
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
