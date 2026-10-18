"use client";

// The side panel: one contact's details, editable in place. A parallel,
// non-blocking panel (no scrim on desktop): the board stays usable beside it.
// It slides in from the right and leaves the same way.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ContactStage } from "@/app/generated/prisma/enums";
import Avatar from "@/components/os/inbox/avatar";
import { initialSource, threadName } from "@/components/os/inbox/names";
import type { ContactRow } from "@/lib/os/contacts-board";
import type { ContactChange } from "@/lib/os/contacts-edit";
import { normalizeTag, parseEmail } from "@/lib/os/contacts-filter";
import { entryLabels, kindTabs, shortAgo, stageLabels, stageOrder } from "@/lib/os/labels";

interface Props {
  contact: ContactRow | null;
  now: number;
  setterName: (id: string | null) => string;
  onClose: () => void;
  onChange: (change: ContactChange, done?: string) => void;
}

export default function ContactPanel({ contact, now, setterName, onClose, onChange }: Props) {
  // Keep the last contact on screen while the panel slides out.
  const [shown, setShown] = useState(contact);
  if (contact && contact !== shown) setShown(contact);
  const isOpen = Boolean(contact);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    returnTo.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const back = returnTo.current;
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
  }, [isOpen, onClose]);

  return (
    <>
      <div className="os-ct-scrim" data-open={isOpen ? "true" : undefined} onClick={onClose} aria-hidden="true" />
      <aside className="os-ct-panel" data-open={isOpen ? "true" : undefined} aria-label="Contact details" inert={!isOpen}>
        {shown && (
          <Details
            key={shown.id}
            c={contact ?? shown}
            now={now}
            setterName={setterName}
            closeRef={closeRef}
            onClose={onClose}
            onChange={onChange}
          />
        )}
      </aside>
    </>
  );
}

function Details({
  c,
  now,
  setterName,
  closeRef,
  onClose,
  onChange,
}: {
  c: ContactRow;
  now: number;
  setterName: (id: string | null) => string;
  closeRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onChange: (change: ContactChange, done?: string) => void;
}) {
  const name = threadName(c.username, c.fullName);
  const [email, setEmail] = useState(c.email ?? "");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [notes, setNotes] = useState(c.notes ?? "");
  const [tag, setTag] = useState("");
  const tab = kindTabs.find((k) => k.kind === c.kind)?.tab ?? "sales";

  function saveEmail() {
    const parsed = parseEmail(email);
    if ("error" in parsed) {
      setEmailError(parsed.error);
      return;
    }
    setEmailError(null);
    if (parsed.email !== c.email) onChange({ type: "details", email: parsed.email }, "Email saved.");
  }

  function saveNotes() {
    const next = notes.trim() || null;
    if (next !== c.notes) onChange({ type: "details", notes: next }, "Notes saved.");
  }

  function addTag(e: React.FormEvent) {
    e.preventDefault();
    const t = normalizeTag(tag);
    if (t && !c.tags.includes(t)) onChange({ type: "addTag", tag: t });
    setTag("");
  }

  return (
    <div className="os-ct-panel-body">
      <header className="os-ct-panel-head">
        <Avatar src={c.avatarUrl} username={initialSource(c.username, c.fullName)} size={44} />
        <div className="who-text">
          <h2 className="name">
            {c.username && !c.fullName?.trim() ? (
              <a href={`https://instagram.com/${c.username}`} target="_blank" rel="noreferrer">
                {name}
              </a>
            ) : (
              c.fullName?.trim() || name
            )}
          </h2>
          {c.username && c.fullName?.trim() && (
            <a className="sub" href={`https://instagram.com/${c.username}`} target="_blank" rel="noreferrer">
              @{c.username}
            </a>
          )}
        </div>
        <button ref={closeRef} type="button" className="os-ct-close" aria-label="Close details" onClick={onClose}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
      </header>

      <div className="os-ct-panel-chips">
        {c.entryPath && <span className="chip">{entryLabels[c.entryPath] ?? c.entryPath}</span>}
        {c.setterStage && <span className="chip quiet">J · {c.setterStage}</span>}
        {c.draftWaiting && <span className="chip ready">Draft waiting</span>}
        {c.lastMessageAt && <span className="os-ct-panel-when">Last message {shortAgo(c.lastMessageAt, now)}</span>}
      </div>

      {c.zernioConversationId ? (
        <Link className="os-button os-ct-thread-link" href={`/os/inbox?tab=${tab}&c=${encodeURIComponent(c.zernioConversationId)}`}>
          Open thread in Inbox
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 3.5 10.5 8 6 12.5" />
          </svg>
        </Link>
      ) : (
        <p className="os-ct-hint">No Instagram thread yet.</p>
      )}

      <dl className="os-ct-fields">
        <div>
          <dt id="ct-kind">Kind</dt>
          <dd>
            <div className="os-segmented" role="group" aria-labelledby="ct-kind">
              {kindTabs.map((k) => (
                <button key={k.kind} type="button" aria-pressed={k.kind === c.kind} onClick={() => k.kind !== c.kind && onChange({ type: "kind", kind: k.kind }, `Marked as ${k.label}.`)}>
                  {k.label}
                </button>
              ))}
            </div>
          </dd>
        </div>

        <div>
          <dt>
            <label htmlFor="ct-stage">Stage</label>
          </dt>
          <dd>
            <span className="os-select">
              <select id="ct-stage" value={c.stage} onChange={(e) => onChange({ type: "stage", stage: e.target.value as ContactStage }, `Moved to ${stageLabels[e.target.value as ContactStage]}.`)}>
                {stageOrder.map((s) => (
                  <option key={s} value={s}>
                    {stageLabels[s]}
                  </option>
                ))}
              </select>
            </span>
          </dd>
        </div>

        <div>
          <dt id="ct-j">J</dt>
          <dd className="os-ct-switch-row">
            <button
              type="button"
              role="switch"
              className="os-switch"
              aria-checked={!c.paused}
              aria-labelledby="ct-j ct-j-state"
              onClick={() => onChange({ type: "paused", paused: !c.paused }, c.paused ? "J is back on." : "J is paused for this contact.")}
            >
              <span className="os-switch-knob" />
            </button>
            <span id="ct-j-state" className="muted">
              {c.paused ? "Paused: J won't draft or nudge" : c.kind === "SALES" ? "Drafts for approval" : "Drafts once they're in Sales"}
            </span>
          </dd>
        </div>

        <div>
          <dt>Setter</dt>
          <dd className="muted">{setterName(c.setterId)}</dd>
        </div>

        <div>
          <dt id="ct-tags">Tags</dt>
          <dd>
            <ul className="os-ct-tag-list" aria-labelledby="ct-tags">
              {c.tags.map((t) => (
                <li key={t} className="chip">
                  {t}
                  <button type="button" aria-label={`Remove tag ${t}`} onClick={() => onChange({ type: "removeTag", tag: t })}>
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="m5 5 6 6M11 5l-6 6" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
            <form className="os-ct-tag-add" onSubmit={addTag}>
              <input className="os-input" aria-label="New tag" placeholder="Add a tag" maxLength={40} value={tag} onChange={(e) => setTag(e.target.value)} />
              <button type="submit" className="os-button" disabled={!normalizeTag(tag)}>
                Add
              </button>
            </form>
          </dd>
        </div>

        <div>
          <dt>
            <label htmlFor="ct-email">Email</label>
          </dt>
          <dd>
            <input
              id="ct-email"
              className="os-input"
              type="email"
              inputMode="email"
              autoComplete="off"
              placeholder="name@example.com"
              value={email}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? "ct-email-error" : undefined}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError(null);
              }}
              onBlur={saveEmail}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveEmail();
                }
              }}
            />
            {emailError && (
              <p id="ct-email-error" className="os-ct-field-error" role="alert">
                {emailError}
              </p>
            )}
          </dd>
        </div>

        <div>
          <dt>
            <label htmlFor="ct-notes">Notes</label>
          </dt>
          <dd>
            <textarea
              id="ct-notes"
              className="os-textarea"
              rows={5}
              maxLength={5000}
              placeholder="Anything to remember about them. Saves when you click away."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={saveNotes}
            />
          </dd>
        </div>
      </dl>
    </div>
  );
}
