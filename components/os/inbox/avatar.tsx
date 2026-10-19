"use client";

// Kept for older call sites: the shared avatar (components/os/ui/avatar.tsx).
import { Avatar as SharedAvatar } from "@/components/os/ui/avatar";

interface AvatarProps {
  /** Instagram CDN url. These expire, so a dead one falls back to the initial. */
  src: string | null | undefined;
  username: string | null;
  size?: number;
  className?: string;
}

export default function Avatar({ src, username, size = 36, className }: AvatarProps) {
  return <SharedAvatar name={username} src={src} size={size} className={className} />;
}
