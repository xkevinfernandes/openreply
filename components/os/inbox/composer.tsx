"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { approveJDraft, draftWithJ, sendInboxMessage } from "@/app/(os)/os/inbox/actions";
import DraftCard from "@/components/os/inbox/draft-card";
import VoicePanel from "@/components/os/inbox/voice-panel";
import type { DraftView } from "@/lib/os/setter/store";
import type { VoiceClipView } from "@/lib/os/voice/clips";
import type { DraftVoicePreview } from "@/lib/os/voice/preview";

interface ComposerProps {
  igUserId: string;
  username: string | null;
  /** How they read: "@handle", their name, or "Instagram user". */
  name?: string;
  avatarUrl?: string | null;
  contactId: string | null;
  /** J's pending draft for this thread, if any. */
  draft: DraftView | null;
  /** Why "Draft with J" is unavailable (personal / unsorted / paused), or null. */
  draftBlockedReason: string | null;
  /** Which of the draft's bubbles go as voice notes (null: none). */
  draftVoice?: DraftVoicePreview | null;
  /** Clips the mic can send. */
  voiceClips?: VoiceClipView[];
  /** Open the mic panel on load (the "send a personal voice note" task links here). */
  voiceAtStart?: boolean;
}

export default function Composer({ igUserId, username, name, avatarUrl, contactId, draft, draftBlockedReason, draftVoice = null, voiceClips = [], voiceAtStart = false }: ComposerProps) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  /** Set while the composer holds an edited copy of J's draft. */
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, startSend] = useTransition();
  const [drafting, startDraft] = useTransition();
  const [voiceOpen, setVoiceOpen] = useState(voiceAtStart);

  const editing = Boolean(draft && editingDraftId === draft.id);
  const who = name ?? (username ? `@${username}` : "them");

  function send() {
    setError(null);
    setNotice(null);
    startSend(async () => {
      // An edited draft goes out through J's approval path, so the edit is logged.
      const result = editing && draft ? await approveJDraft(draft.id, text) : await sendInboxMessage(igUserId, text);
      if (result.error) {
        setError(result.error);
        return;
      }
      setText("");
      setEditingDraftId(null);
      router.refresh();
    });
  }

  function askJ() {
    if (!contactId) return;
    setError(null);
    setNotice(null);
    startDraft(async () => {
      const result = await draftWithJ(contactId);
      if (result.error) setError(result.error);
      else if (result.notice) setNotice(result.notice);
      router.refresh();
    });
  }

  function editDraft(d: DraftView) {
    setText(d.bubbles.join("\n\n"));
    setEditingDraftId(d.id);
    setError(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  return (
    <div className="os-composer-wrap">
      {draft && !editing && (
        <DraftCard
          key={draft.id}
          draft={draft}
          username={username}
          name={who}
          avatarUrl={avatarUrl ?? null}
          voice={draftVoice}
          regenerating={drafting}
          onEdit={() => editDraft(draft)}
          onRegenerate={askJ}
          onError={setError}
        />
      )}
      {drafting && !draft && (
        <div className="os-draft os-draft-writing" role="status">
          <span className="os-draft-dot" aria-hidden="true" />
          J is reading the thread and writing…
        </div>
      )}

      {voiceOpen && contactId && <VoicePanel contactId={contactId} who={who} clips={voiceClips} onClose={() => setVoiceOpen(false)} />}

      <form
        className="os-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {error && (
          <p className="os-composer-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="os-composer-notice" role="status">
            {notice}
          </p>
        )}
        {editing && (
          <p className="os-composer-editing">
            Editing J&apos;s draft. A blank line starts a new bubble. Recorded lines still go as voice notes.
            <button
              type="button"
              className="os-link"
              onClick={() => {
                setEditingDraftId(null);
                setText("");
              }}
            >
              Back to draft
            </button>
          </p>
        )}
        <div className="os-compose">
          <label htmlFor="composer-text" className="sr-only">
            Message {who}
          </label>
          <textarea
            id="composer-text"
            ref={textareaRef}
            rows={editing ? 4 : 2}
            placeholder={`Message ${who}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
            }}
          />
          <div className="os-compose-bar">
            <span className="os-compose-hint" aria-hidden="true">
              <kbd>⌘</kbd>
              <kbd>↵</kbd> to send
            </span>
            <div className="os-composer-actions">
              <button
                type="button"
                className="os-button ghost os-mic"
                aria-pressed={voiceOpen}
                aria-label="Voice note"
                title={contactId ? "Record or send a voice note" : "Not a contact yet."}
                disabled={!contactId || sending}
                onClick={() => setVoiceOpen((v) => !v)}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="5.5" y="1.75" width="5" height="8" rx="2.5" />
                  <path d="M3.25 7.5a4.75 4.75 0 0 0 9.5 0M8 12.25v2" />
                </svg>
              </button>
              {!draft && (
                <button
                  type="button"
                  className="os-button"
                  disabled={!contactId || Boolean(draftBlockedReason) || drafting || sending}
                  title={draftBlockedReason ?? "J reads the whole thread and drafts the next message. Nothing sends until you approve."}
                  onClick={askJ}
                >
                  {drafting ? "J is writing…" : "Draft with J"}
                </button>
              )}
              <button type="submit" className="os-button primary" disabled={sending || !text.trim()}>
                {sending ? "Sending…" : editing ? "Send edited" : "Send"}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
