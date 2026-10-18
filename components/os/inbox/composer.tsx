"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { approveJDraft, draftWithJ, sendInboxMessage } from "@/app/(os)/os/inbox/actions";
import DraftCard from "@/components/os/inbox/draft-card";
import type { DraftView } from "@/lib/os/setter/store";

interface ComposerProps {
  igUserId: string;
  username: string | null;
  avatarUrl?: string | null;
  contactId: string | null;
  /** J's pending draft for this thread, if any. */
  draft: DraftView | null;
  /** Why "Draft with J" is unavailable (personal / unsorted / paused), or null. */
  draftBlockedReason: string | null;
}

export default function Composer({ igUserId, username, avatarUrl, contactId, draft, draftBlockedReason }: ComposerProps) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  /** Set while the composer holds an edited copy of J's draft. */
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, startSend] = useTransition();
  const [drafting, startDraft] = useTransition();

  const editing = Boolean(draft && editingDraftId === draft.id);

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
          avatarUrl={avatarUrl ?? null}
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
            Editing J&apos;s draft. A blank line starts a new bubble.
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
        <label htmlFor="composer-text" className="sr-only">
          Message @{username ?? "them"}
        </label>
        <textarea
          id="composer-text"
          ref={textareaRef}
          rows={editing ? 4 : 2}
          placeholder={`Message @${username ?? "them"}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
          }}
        />
        <div className="os-composer-actions">
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
      </form>
    </div>
  );
}
