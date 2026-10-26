"use client";

// The one composer (InboxA): J's draft pre-filled as editable dashed bubbles
// marked "Not sent", or Kevin's own. Approve & send ⏎ · Hold H · Regenerate R
// · Write my own. E focuses the draft. Nothing sends without Approve.
// Keys arrive on the DM OS event bus (components/os/keys.ts), so the ⌘K
// palette drives the same actions. Owner: S1.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { approveJDraft, draftWithJ, holdJDraft, sendInboxMessage } from "@/app/(os)/os/inbox/actions";
import VoicePanel from "@/components/os/inbox/voice-panel";
import { closeInspect, currentInspect, toggleInspect, useInspect } from "@/components/os/inspect/bus";
import { isTypingTarget, useOsCommand } from "@/components/os/keys";
import {
  appendLink,
  bubbleKey,
  editedText,
  initialComposer,
  mergeBubble,
  outgoing,
  setBubble,
  splitBubble,
  writeOwn,
  type ComposerState,
} from "@/components/os/thread/composer-model";
import { Kbd, SetterMark } from "@/components/os/ui";
import { formatSlot, formatTime, tzCity } from "@/lib/os/integrations/calendar/slots";
import { calendarName, type BookingPayload } from "@/lib/os/integrations/calendar/types";
import type { DraftView } from "@/lib/os/setter/store";
import type { VoiceClipView } from "@/lib/os/voice/clips";
import type { DraftVoicePreview } from "@/lib/os/voice/preview";

/** Flags that mean "read this one carefully", as a chip with the why on hover. */
const FLAGS: Record<string, { label: string; title: string }> = {
  human_agent: { label: "Outside 24h", title: "Sends under Meta's HUMAN_AGENT tag. Only approve if you'd send it yourself right now." },
  invite: { label: "Invitation", title: "J thinks it's time to invite them." },
  unqualified: { label: "Not qualified", title: "J couldn't quote their goal and challenge yet." },
  price: { label: "Price", title: "Price or payment in the draft. Check it's allowed in DMs." },
  booking: { label: "Books the call", title: "Approve books this time on your calendar first, then sends." },
  slot_unavailable: { label: "Time not free", title: "That time isn't free on your calendar. Edit or regenerate." },
  needs_email: { label: "No email", title: "J has the time but not their email, so this doesn't book anything." },
  calendar_off: { label: "No calendar", title: "Your calendar didn't answer, so J used the booking link." },
  sample: { label: "Sample", title: "Written by the fake drafter, not a model." },
};

export interface ComposerResource {
  id: string;
  name: string;
  link: string;
}

export interface ComposerProps {
  contactId: string | null;
  igUserId: string;
  conversationId: string;
  /** "@maya.builds" */
  who: string;
  draft: DraftView | null;
  /** Why J can't draft here (Pitches, Personal, paused), or null. */
  draftBlockedReason: string | null;
  setterName?: string;
  resources?: ComposerResource[];
  voiceClips?: VoiceClipView[];
  draftVoice?: DraftVoicePreview | null;
  voiceAtStart?: boolean;
  /** Answer the keyboard and palette (one composer on screen does). */
  listen?: boolean;
  /** After any action settles (the Chat tab reloads its thread). */
  onSettled?: () => void;
}

const icon = (d: string, size = 16) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const I_INFO = "M8 13.8A5.8 5.8 0 1 0 8 2.2a5.8 5.8 0 0 0 0 11.6ZM8 7.2v3.6M8 5.2v.1";
const I_PEN = "M10.5 2.5 13.5 5.5 6 13H3v-3l7.5-7.5Z";
const I_REGEN = "M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.5h-2.5";
const I_CLIP = "M12.5 7.5 8 12a3 3 0 0 1-4.2-4.2l4.6-4.6a2 2 0 0 1 2.8 2.8L6.6 10.6a1 1 0 0 1-1.4-1.4L9.5 5";
const I_CODE = "M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5";
const I_MIC = "M6 3.8a2 2 0 0 1 4 0v4a2 2 0 0 1-4 0v-4ZM3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.2";

export default function Composer({
  contactId,
  igUserId,
  conversationId,
  who,
  draft,
  draftBlockedReason,
  setterName = "J",
  resources = [],
  voiceClips = [],
  draftVoice = null,
  voiceAtStart = false,
  listen = true,
  onSettled,
}: ComposerProps) {
  const router = useRouter();
  const [state, setState] = useState<ComposerState>(() => initialComposer(draft?.bubbles));
  const [why, setWhy] = useState(false);
  const [attach, setAttach] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(voiceAtStart);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "send" | "hold" | "regen">(null);
  const [, startTransition] = useTransition();
  const fields = useRef<(HTMLTextAreaElement | null)[]>([]);
  const focusAt = useRef<{ i: number; caret: number } | null>(null);

  // A new draft remounts the composer (hosts key it on the draft).
  useEffect(() => {
    const f = focusAt.current;
    if (!f) return;
    focusAt.current = null;
    const el = fields.current[f.i];
    if (el) {
      el.focus();
      const c = Math.min(f.caret, el.value.length);
      el.setSelectionRange(c, c);
    }
  });

  const isDraft = state.mode === "draft" && Boolean(draft);
  const out = outgoing(state);
  const inspecting = useInspect()?.draftId === draft?.id && Boolean(draft);

  // I opens J's brain for this draft; the drawer closes with the draft.
  const draftId = draft?.id ?? null;
  useEffect(() => {
    if (!draftId || !listen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "i" && e.key !== "I") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTypingTarget(e.target)) return;
      if (document.querySelector("[role=dialog][aria-modal=true]")) return;
      e.preventDefault();
      toggleInspect(draftId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draftId, listen]);
  // Another thread or a new draft: a drawer for some other draft closes.
  useEffect(() => {
    const open = currentInspect();
    if (listen && open && open.draftId !== draftId) closeInspect();
  }, [draftId, listen]);
  const canSend = out.length > 0 && !busy;

  function run(kind: "send" | "hold" | "regen", act: () => Promise<{ error?: string; notice?: string }>, after?: () => void) {
    if (busy) return;
    setError(null);
    setNotice(null);
    setBusy(kind);
    startTransition(async () => {
      try {
        const r = await act();
        if (r.error) setError(r.error);
        else {
          if (r.notice) setNotice(r.notice);
          after?.();
        }
      } catch {
        setError("That didn't go through. Try again.");
      } finally {
        setBusy(null);
        router.refresh();
        onSettled?.();
      }
    });
  }

  function approve() {
    if (!canSend) return;
    const edit = draft ? editedText(state, draft.bubbles) : null;
    run(
      "send",
      () => (draft ? approveJDraft(draft.id, edit) : sendInboxMessage(igUserId, out, { conversationId, contactId })),
      () => setState(writeOwn())
    );
  }

  function hold() {
    if (!draft) return;
    run("hold", () => holdJDraft(draft.id), () => setState(writeOwn()));
  }

  function regenerate() {
    if (!contactId || draftBlockedReason) return;
    run("regen", () => draftWithJ(contactId));
  }

  function focusDraft() {
    const i = state.bubbles.length - 1;
    focusAt.current = { i, caret: state.bubbles[i]?.length ?? 0 };
    setState((s) => ({ ...s }));
  }

  function addResource(r: ComposerResource) {
    setAttach(false);
    setState((s) => appendLink(s, r.link));
  }

  // ⌘K sends {contactId}: only the composer for that contact acts on it.
  const mine = (d: { contactId?: string }) => listen && (!d.contactId || !contactId || d.contactId === contactId);
  useOsCommand("approve", (d) => mine(d) && approve());
  useOsCommand("hold", (d) => mine(d) && hold());
  useOsCommand("regenerate", (d) => mine(d) && regenerate());
  useOsCommand("focus-draft", (d) => mine(d) && focusDraft());
  useOsCommand("send-resource", (d) => {
    if (!mine(d)) return;
    const r = resources.find((x) => x.id === d.resourceId);
    if (r) addResource(r);
  });

  function onKey(i: number, e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    const k = bubbleKey(e.nativeEvent, { caret: el.selectionStart, selectionEmpty: el.selectionStart === el.selectionEnd, index: i });
    if (!k) return;
    e.preventDefault();
    if (k === "send") approve();
    else if (k === "blur") el.blur();
    else if (k === "split") {
      focusAt.current = { i: i + 1, caret: 0 };
      setState((s) => splitBubble(setBubble(s, i, el.value), i, el.selectionStart));
    } else if (k === "merge") {
      const prevLen = state.bubbles[i - 1]?.length ?? 0;
      focusAt.current = { i: i - 1, caret: prevLen + (prevLen && el.value ? 1 : 0) };
      setState((s) => mergeBubble(setBubble(s, i, el.value), i));
    }
  }

  const voiceNotes = draftVoice ? draftVoice.flat().filter((p) => p.type === "voice").length : 0;
  const flags = isDraft ? (draft?.flags ?? []).filter((f) => FLAGS[f]) : [];

  return (
    <div className="os-cmp-wrap">
      {voiceOpen && contactId ? <VoicePanel contactId={contactId} who={who} clips={voiceClips} onClose={() => setVoiceOpen(false)} /> : null}
      <div className="os-cmp" aria-label={`Reply to ${who}`} data-mode={isDraft ? "draft" : "own"} aria-busy={busy ? true : undefined}>
        <div className="os-cmp-head">
          {isDraft && draft ? (
            <>
              <SetterMark name={setterName} size={20} title={`${setterName}'s draft`} />
              <span className="os-cmp-status">Not sent</span>
              {draft.reasoning ? (
                <button type="button" className="os-cmp-why" aria-label="Why this draft?" title="Why this draft?" aria-expanded={why} onClick={() => setWhy((w) => !w)}>
                  {icon(I_INFO, 13)}
                </button>
              ) : null}
              {voiceNotes ? (
                <span className="os-cmp-flag" title="These lines go as your recorded voice notes.">
                  {voiceNotes === 1 ? "1 voice note" : `${voiceNotes} voice notes`}
                </span>
              ) : null}
              {flags.map((f) => (
                <span key={f} className="os-cmp-flag" data-tone={f === "sample" ? undefined : "warn"} title={FLAGS[f].title}>
                  {FLAGS[f].label}
                </span>
              ))}
              <button type="button" className="os-cmp-inspect" aria-label="Inspect" title="Inspect (I)" aria-pressed={inspecting} onClick={() => toggleInspect(draft.id)}>
                {icon(I_CODE, 11)}
                Inspect
              </button>
              <span className="os-cmp-sp" />
              <button type="button" className="os-cmp-text-btn" title="Write my own" onClick={() => setState(writeOwn())}>
                {icon(I_PEN, 12)}
                Write my own
              </button>
            </>
          ) : (
            <>
              <span className="os-cmp-status">{draftBlockedReason ?? (busy === "regen" ? `${setterName} is writing…` : "")}</span>
              <span className="os-cmp-sp" />
              {draft ? (
                <button type="button" className="os-cmp-text-btn" onClick={() => setState(initialComposer(draft.bubbles))}>
                  <SetterMark name={setterName} size={16} title={`${setterName}'s draft`} />
                  Back to draft
                </button>
              ) : !draftBlockedReason && contactId ? (
                <button type="button" className="os-cmp-text-btn" disabled={Boolean(busy)} onClick={regenerate}>
                  <SetterMark name={setterName} size={16} title={`Draft with ${setterName}`} />
                  Draft with {setterName}
                </button>
              ) : null}
            </>
          )}
        </div>

        {why && draft?.reasoning ? <p className="os-cmp-reason">{draft.reasoning}</p> : null}
        {isDraft && draft?.booking ? <BookingBox booking={draft.booking} /> : null}

        <div className="os-cmp-bubbles" role="group" aria-label={isDraft ? `Reply, pre-filled with ${setterName}'s draft` : `Message ${who}`}>
          {state.bubbles.map((b, i) => (
            <textarea
              key={i}
              ref={(el) => {
                fields.current[i] = el;
              }}
              className="os-cmp-bubble"
              data-draft={isDraft || undefined}
              rows={1}
              value={b}
              placeholder={i === 0 && !isDraft ? `Message ${who}` : undefined}
              aria-label={`Bubble ${i + 1}`}
              onChange={(e) => setState((s) => setBubble(s, i, e.target.value))}
              onKeyDown={(e) => onKey(i, e)}
            />
          ))}
        </div>

        {error ? (
          <p className="os-cmp-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="os-cmp-notice" role="status">
            {notice}
          </p>
        ) : null}

        <div className="os-cmp-bar">
          <button type="button" className="os-cmp-send" disabled={!canSend} onClick={approve}>
            {busy === "send" ? "Sending…" : isDraft ? (draft?.booking?.mode === "book" ? "Book & send" : "Approve & send") : "Send"}
            <Kbd>⏎</Kbd>
          </button>
          <button type="button" className="os-cmp-btn" disabled={!draft || Boolean(busy)} onClick={hold} title="Say nothing for now">
            {busy === "hold" ? "Holding…" : "Hold"}
            <Kbd>H</Kbd>
          </button>
          <button
            type="button"
            className="os-cmp-icon"
            aria-label="Regenerate"
            title={draftBlockedReason ?? "Regenerate (R)"}
            disabled={!contactId || Boolean(draftBlockedReason) || Boolean(busy)}
            onClick={regenerate}
            data-spin={busy === "regen" || undefined}
          >
            {icon(I_REGEN, 14)}
          </button>
          <span className="os-cmp-sp" />
          {resources.length ? (
            <span className="os-cmp-attach">
              <button type="button" className="os-cmp-ghost" aria-label="Attach lead magnet" title="Attach lead magnet" aria-expanded={attach} onClick={() => setAttach((a) => !a)}>
                {icon(I_CLIP)}
              </button>
              {attach ? (
                <ul className="os-cmp-menu" role="menu">
                  {resources.map((r) => (
                    <li key={r.id} role="none">
                      <button type="button" role="menuitem" onClick={() => addResource(r)}>
                        {r.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </span>
          ) : null}
          <button
            type="button"
            className="os-cmp-ghost"
            aria-label="Record voice note"
            title={contactId ? "Record voice note" : "Not a contact yet."}
            aria-pressed={voiceOpen}
            disabled={!contactId}
            onClick={() => setVoiceOpen((v) => !v)}
          >
            {icon(I_MIC)}
          </button>
        </div>
      </div>
    </div>
  );
}

/** What Approve books, up front: the time in their timezone and yours. */
function BookingBox({ booking: b }: { booking: BookingPayload }) {
  const same = b.timezone === b.hostTimezone;
  return (
    <div className="os-cmp-booking" aria-label="Booking details">
      <strong>{formatSlot(b.start, b.timezone)}</strong>
      <span>
        {same ? `${tzCity(b.timezone)} time` : `${tzCity(b.timezone)} · ${formatTime(b.start, b.hostTimezone)} for you`}
        {b.durationMinutes ? ` · ${b.durationMinutes} min` : ""} · {b.email}
      </span>
      <span>{b.mode === "link" ? `${calendarName(b.provider)} link` : `${b.eventName ?? "Call"} on ${calendarName(b.provider)}`}</span>
    </div>
  );
}
