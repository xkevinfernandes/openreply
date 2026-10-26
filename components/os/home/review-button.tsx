"use client";

// "Review N drafts ⏎": the one call to action on Home. ⏎ anywhere on Home
// (not while typing) opens the Inbox on the first draft.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { isTypingTarget } from "@/components/os/keys";
import { inboxStreamHref } from "@/lib/os/inbox-stream";

// The same URL as Home's "Drafts waiting" row and the inbox filter itself.
const HREF = inboxStreamHref({ filter: "drafts" });

export default function ReviewButton({ count }: { count: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!count) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTypingTarget(e.target)) return;
      if (document.querySelector("[role=dialog]")) return;
      e.preventDefault();
      router.push(HREF);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, router]);

  if (!count) return <span className="os-home-clear">No drafts waiting</span>;
  return (
    <Link href={HREF} className="os-button primary os-home-review">
      Review {count} draft{count === 1 ? "" : "s"} <span className="os-home-review-key">⏎</span>
    </Link>
  );
}
