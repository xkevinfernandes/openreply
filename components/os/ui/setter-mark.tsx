/** The setter's initial in an ink square: who wrote a message (J, Nova). */
export function SetterMark({ name, size = 16, title }: { name: string; size?: 16 | 20 | 24; title?: string }) {
  const label = title ?? `Sent by ${name}`;
  return (
    <span className="os-setter-mark" data-size={size} title={label} aria-label={label} role="img">
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
