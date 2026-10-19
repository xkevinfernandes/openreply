/** A key hint: ⏎, H, R, ⌘K. */
export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="os-kbd">{children}</kbd>;
}
