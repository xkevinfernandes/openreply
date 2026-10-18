"use client";

import { useState } from "react";

interface AvatarProps {
  /** Instagram CDN url. These expire, so a broken one falls back to the initial. */
  src: string | null | undefined;
  username: string | null;
  size?: number;
  className?: string;
}

/** Round profile picture with the initial disc as the fallback. */
export default function Avatar({ src, username, size = 36, className }: AvatarProps) {
  const [failed, setFailed] = useState<string | null>(null);
  const initial = (username ?? "?").slice(0, 1).toUpperCase();
  const show = src && failed !== src;

  return (
    <span
      className={["os-avatar", className].filter(Boolean).join(" ")}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.36)) }}
      aria-hidden="true"
    >
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element -- IG CDN urls expire; next/image would cache them
        <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(src)} />
      ) : (
        initial
      )}
    </span>
  );
}
