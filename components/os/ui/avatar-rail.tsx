import Link from "next/link";

export interface AvatarProps {
  name: string | null;
  src?: string | null;
  size?: 24 | 32 | 40;
}

/** Profile picture, or the first letter on a tint. */
export function Avatar({ name, src, size = 32 }: AvatarProps) {
  const initial = (name ?? "?").replace(/^@/, "").charAt(0).toUpperCase() || "?";
  return (
    <span className="os-avatar" data-size={size} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt="" referrerPolicy="no-referrer" /> : initial}
    </span>
  );
}

export interface RailItem {
  id: string;
  name: string | null;
  avatarUrl?: string | null;
  href: string;
  /** Green dot: a draft is waiting. */
  dot?: boolean;
  current?: boolean;
}

/** The collapsed thread list: avatars only, green dots for drafts. */
export function AvatarRail({ items, ariaLabel }: { items: RailItem[]; ariaLabel: string }) {
  return (
    <nav className="os-avatar-rail" aria-label={ariaLabel}>
      {items.map((it) => (
        <Link
          key={it.id}
          href={it.href}
          className="os-avatar-rail-item"
          aria-current={it.current ? "page" : undefined}
          aria-label={`${it.name ?? "Unknown"}${it.dot ? " · draft waiting" : ""}`}
          title={it.name ?? undefined}
        >
          <Avatar name={it.name} src={it.avatarUrl} size={32} />
          {it.dot ? <span className="os-avatar-rail-dot" aria-hidden="true" /> : null}
        </Link>
      ))}
    </nav>
  );
}
