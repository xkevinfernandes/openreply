"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { approveJDraft, discardJDraft } from "@/app/(os)/os/inbox/actions";
import Avatar from "@/components/os/inbox/avatar";
import { formatSlot, formatTime, tzCity } from "@/lib/os/integrations/calendar/slots";
import { calendarName, type BookingPayload } from "@/lib/os/integrations/calendar/types";
import type { DraftView } from "@/lib/os/setter/store";

const KIND_LABEL: Record<string, string> = {
  reply: "Reply",
  value_opener: "Opener",
  nudge: "Nudge",
  invite: "Invitation",
  booking: "Booking",
};

/** Flags that mean "read this one carefully" (spec item 9). */
const FLAG_LABEL: Record<string, { label: string; title: string }> = {
  human_agent: { label: "Outside 24h", title: "Sends under Meta's HUMAN_AGENT tag. Only approve if you'd send it yourself right now." },
  invite: { label: "Invitation", title: "J thinks it's time to invite them. You pick the route." },
  unqualified: { label: "Not fully qualified", title: "J couldn't quote their goal and challenge yet. Consider discarding." },
  price: { label: "Mentions price", title: "Price or payment in the draft. Check it's allowed in DMs." },
  booking: { label: "Books the call", title: "Approve books this time on your calendar first, then sends. Nothing is booked until you approve." },
  slot_unavailable: { label: "Time not free", title: "The time J talked about isn't free on your calendar. J didn't book it; edit or regenerate." },
  needs_email: { label: "No email yet", title: "J has the time but not their email, so this doesn't book anything." },
  calendar_off: { label: "Calendar unavailable", title: "Your calendar didn't answer (or no event type is picked), so J used the booking link path." },
  sample: { label: "Sample draft", title: "Written by the fake drafter, not a model. Set ANTHROPIC_API_KEY or OS_DRAFTER." },
};

interface DraftCardProps {
  draft: DraftView;
  username: string | null;
  /** How they read: "@handle", their name, or "Instagram user". */
  name?: string;
  avatarUrl?: string | null;
  regenerating: boolean;
  onEdit: () => void;
  onRegenerate: () => void;
  onError: (message: string | null) => void;
}

export default function DraftCard({ draft, username, name, avatarUrl, regenerating, onEdit, onRegenerate, onError }: DraftCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<"approve" | "discard" | null>(null);
  const busy = pending || regenerating;

  function run(kind: "approve" | "discard") {
    onError(null);
    setAction(kind);
    startTransition(async () => {
      const result = kind === "approve" ? await approveJDraft(draft.id) : await discardJDraft(draft.id);
      if (result.error) onError(result.error);
      router.refresh();
    });
  }

  return (
    <section className="os-draft" aria-label="J's draft" aria-busy={busy} data-leaving={pending && action ? action : undefined}>
      <header className="os-draft-head">
        <span className="os-draft-title">
          <span className="os-draft-mark" aria-hidden="true">
            J
          </span>
          {KIND_LABEL[draft.kind] ?? "Draft"} for
          <span className="os-draft-who">
            <Avatar src={avatarUrl} username={username ?? name ?? null} size={18} />
            {name ?? (username ? `@${username}` : "them")}
          </span>
        </span>
        <span className="os-draft-chips">
          {draft.setterStage && <span className="chip quiet">{draft.setterStage}</span>}
          {draft.flags.map((f) =>
            FLAG_LABEL[f] ? (
              <span key={f} className={`chip${f === "sample" ? " quiet" : " flag"}`} title={FLAG_LABEL[f].title}>
                {FLAG_LABEL[f].label}
              </span>
            ) : null
          )}
        </span>
      </header>

      {draft.booking && <BookingBox booking={draft.booking} />}
      {draft.sendError && draft.booking && (
        <p className="os-draft-senderr" role="status">
          {draft.sendError}
        </p>
      )}

      <ol className="os-draft-bubbles">
        {draft.bubbles.map((b, i) => (
          <li key={i}>
            <span className="bubble">{b}</span>
          </li>
        ))}
      </ol>

      {draft.reasoning && (
        <details className="os-draft-why">
          <summary>Why this</summary>
          <p>{draft.reasoning}</p>
        </details>
      )}

      <div className="os-draft-actions">
        <button type="button" className="os-button ghost" disabled={busy} onClick={() => run("discard")}>
          {pending && action === "discard" ? "Discarding…" : "Discard"}
        </button>
        <button type="button" className="os-button ghost" disabled={busy} onClick={onRegenerate}>
          {regenerating ? "Rewriting…" : "Regenerate"}
        </button>
        <button type="button" className="os-button" disabled={busy} onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="os-button primary" disabled={busy} onClick={() => run("approve")}>
          {pending && action === "approve"
            ? draft.booking?.mode === "book"
              ? "Booking…"
              : draft.bubbles.length > 1
                ? `Sending ${draft.bubbles.length} bubbles…`
                : "Sending…"
            : draft.booking?.mode === "book"
              ? draft.bubbles.length > 1
                ? `Book & send ${draft.bubbles.length}`
                : "Book & send"
              : draft.bubbles.length > 1
                ? `Approve & send ${draft.bubbles.length}`
                : "Approve & send"}
        </button>
      </div>
    </section>
  );
}

/** What Approve books, up front: the time in their timezone and yours, who
 *  the invite goes to, and on which calendar. */
function BookingBox({ booking: b }: { booking: BookingPayload }) {
  const same = b.timezone === b.hostTimezone;
  return (
    <div className="os-draft-booking" aria-label="Booking details">
      <span className="os-draft-booking-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <rect x="4" y="5.5" width="16" height="14" rx="2.5" />
          <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
        </svg>
      </span>
      <div className="os-draft-booking-main">
        <strong>{formatSlot(b.start, b.timezone)}</strong>
        <span>
          {same ? `${tzCity(b.timezone)} time` : `their time (${tzCity(b.timezone)}) · ${formatTime(b.start, b.hostTimezone)} for you`}
          {b.durationMinutes ? ` · ${b.durationMinutes} min` : ""}
        </span>
        <span>
          {b.name} · {b.email}
        </span>
      </div>
      <span className="os-draft-booking-via">
        {b.mode === "link" ? `${calendarName(b.provider)} link for this time` : `${b.eventName ?? "Call"} on ${calendarName(b.provider)}`}
      </span>
    </div>
  );
}
