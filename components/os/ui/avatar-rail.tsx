import Link from "next/link";
import { Avatar } from "@/components/os/ui/avatar";

export { Avatar, type AvatarProps } from "@/components/os/ui/avatar";

export interface RailItem {
  id: string;
  name: string | null;
  avatarUrl?: string | null;
  href: string;
  /** Amber dot: a draft is waiting ("decide this"). */
  dot?: boolean;
  current?: boolean;
}

/** The collapsed thread list: avatars only, amber dots for drafts. */
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
