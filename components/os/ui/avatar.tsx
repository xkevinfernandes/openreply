"use client";

// The one avatar for the DM OS: the IG picture, or the initial on a disc.
// IG CDN urls expire; an expired, missing or failing url shows the initial,
// never the browser's broken-image icon. A failure that happens before
// hydration (onError never fires) is caught by checking the element on mount.

import { useCallback, useState } from "react";
import { avatarInitial, liveAvatarUrl } from "@/lib/os/contacts-avatar";

export interface AvatarProps {
  name: string | null;
  src?: string | null;
  /** Pixels. 24 / 32 / 40 use the os.css sizes; anything else is inline. */
  size?: number;
  className?: string;
}

const PRESET = new Set([24, 32, 40]);

export function Avatar({ name, src, size = 32, className }: AvatarProps) {
  const url = liveAvatarUrl(src);
  const [failed, setFailed] = useState<string | null>(null);
  const show = url !== null && failed !== url;

  // Already finished loading and empty: it broke before React was listening.
  const check = useCallback(
    (img: HTMLImageElement | null) => {
      if (img && url && img.complete && img.naturalWidth === 0) setFailed(url);
    },
    [url]
  );

  return (
    <span
      className={["os-avatar", className].filter(Boolean).join(" ")}
      data-size={PRESET.has(size) ? size : undefined}
      data-img={show ? "true" : undefined}
      style={PRESET.has(size) ? undefined : { width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.36)) }}
      aria-hidden="true"
    >
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element -- IG CDN urls expire; next/image would cache them
        <img
          ref={check}
          src={url}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => setFailed(url)}
        />
      ) : (
        avatarInitial(name)
      )}
    </span>
  );
}
