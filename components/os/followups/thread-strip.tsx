"use client";

// The follow-up strip on a thread: what's queued next (Send now / Skip /
// Cancel sequence), the before-the-call plan, "did they show?", your
// voice-note task, and the per-thread Follow-ups switch.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setFollowupsOn } from "@/app/(os)/os/follow-ups/actions";
import { AttendanceRow, QueueRow, TaskCard, rel } from "@/components/os/followups/sequence-queue";
import type { ThreadFollowups } from "@/lib/os/sequences/view";

export default function ThreadStrip({ contactId, data, now }: { contactId: string; data: ThreadFollowups; now: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [on, setOn] = useState(!data.off);
  const [error, setError] = useState<string | null>(null);
  const later = data.upcoming.filter((u) => !u.dropped && u.at !== data.live?.dueAt);

  function toggle() {
    const next = !on;
    setOn(next); // the switch moves on press
    setError(null);
    start(async () => {
      const r = await setFollowupsOn(contactId, next);
      if (r.error) {
        setOn(!next);
        setError(r.error);
      }
      router.refresh();
    });
  }

  return (
    <section className="os-fu-strip" aria-label="Follow-ups" aria-busy={pending}>
      <header className="os-fu-strip-head">
        <span className="os-fu-strip-title">
          Follow-ups
          {!data.live && on && data.why && <span className="muted"> · {data.why}</span>}
          {!on && <span className="muted"> · off for this thread</span>}
        </span>
        <span className="os-fu-strip-switch">
          <span className="muted" id={`fu-switch-${contactId}`}>
            {on ? "On" : "Off"}
          </span>
          <button type="button" role="switch" className="os-switch" aria-checked={on} aria-labelledby={`fu-switch-${contactId}`} disabled={pending} onClick={toggle} title="Follow-ups for this thread">
            <span className="os-switch-knob" />
          </button>
        </span>
      </header>
      {error && (
        <p className="os-fu-error" role="alert">
          {error}
        </p>
      )}
      {data.attendance && <AttendanceRow a={data.attendance} now={now} compact />}
      {data.tasks.map((t) => (
        <TaskCard key={t.id} t={t} compact />
      ))}
      {data.live && <QueueRow q={data.live} now={now} compact />}
      {on && later.length > 0 && (
        <p className="os-fu-meta os-fu-strip-later">Then: {later.map((u) => `${u.label} ${rel(u.at, now)}`).join(" · ")}</p>
      )}
    </section>
  );
}
