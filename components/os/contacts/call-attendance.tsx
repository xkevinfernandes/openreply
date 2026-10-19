"use client";

// Showed / No-show on the contact panel, once the call has started. Showed
// gives you the voice-note task; No-show starts J's warm re-engagement
// (drafts you approve).

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { markCall } from "@/app/(os)/os/follow-ups/actions";

export default function CallAttendance({ contactId }: { contactId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; notice?: string } | null>(null);
  function mark(a: "SHOWED" | "NO_SHOW") {
    setMsg(null);
    start(async () => {
      setMsg(await markCall(contactId, a));
      router.refresh();
    });
  }
  return (
    <div className="os-ct-attendance" aria-busy={pending}>
      <span className="muted">Did they show?</span>
      <span className="os-fu-actions">
        <button type="button" className="os-button" disabled={pending} onClick={() => mark("NO_SHOW")}>
          No-show
        </button>
        <button type="button" className="os-button primary" disabled={pending} onClick={() => mark("SHOWED")}>
          Showed
        </button>
      </span>
      {msg && (msg.error || msg.notice) && (
        <p className={msg.error ? "os-fu-error" : "os-fu-notice"} role={msg.error ? "alert" : "status"}>
          {msg.error ?? msg.notice}
        </p>
      )}
    </div>
  );
}
