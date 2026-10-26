"use client";

// The open thread's own actions (dm-crm 009, 011, 012, 014): star, Mark
// unread, Archive / Restore, Mark spam / Not spam, and on narrow screens the
// "Contact" button that opens today's contact panel as a sheet.

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { archiveThreads, markThreadsSpam, markThreadsUnread, starThreads, type StreamActionResult } from "@/app/(os)/os/inbox/stream-actions";
import { starIcon } from "@/components/os/inbox/inbox-list";

interface Props {
  contactId: string;
  starred: boolean;
  archived: boolean;
  spam: boolean;
  /** Where Mark unread goes (the list, with the thread closed). */
  listHref: string;
  /** Show the Contact sheet button (a contact panel exists). */
  hasPanel: boolean;
}

export default function ThreadActions({ contactId, starred: initialStar, archived, spam, listHref, hasPanel }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [starred, setStarred] = useState(initialStar);
  const [err, setErr] = useState<string | null>(null);

  const [seenStar, setSeenStar] = useState(initialStar);
  if (seenStar !== initialStar) {
    setSeenStar(initialStar);
    setStarred(initialStar);
  }

  const act = (fn: () => Promise<StreamActionResult>, then?: () => void) =>
    start(async () => {
      const r = await fn().catch(() => ({ error: "That didn't save." }) as StreamActionResult);
      setErr(r.error ?? null);
      if (r.error) return;
      if (then) then();
      else router.refresh();
    });

  return (
    <span className="os-ix-tacts" aria-busy={pending || undefined}>
      <button
        type="button"
        className="os-ix-iconbtn os-ix-tact"
        aria-pressed={starred}
        aria-label={starred ? "Unstar" : "Star"}
        title={starred ? "Unstar" : "Star"}
        data-on={starred || undefined}
        onClick={() => {
          setStarred(!starred);
          act(() => starThreads([contactId], !starred));
        }}
      >
        {starIcon(starred)}
      </button>
      <details className="os-ix-tmenu">
        <summary className="os-ix-iconbtn" aria-label="More" title="More">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <circle cx="3.5" cy="8" r="1.3" />
            <circle cx="8" cy="8" r="1.3" />
            <circle cx="12.5" cy="8" r="1.3" />
          </svg>
        </summary>
        <div className="os-ix-tmenu-list" role="menu">
          <button type="button" role="menuitem" onClick={() => act(() => markThreadsUnread([contactId]), () => router.push(listHref))}>
            Mark unread
          </button>
          <button type="button" role="menuitem" onClick={() => act(() => archiveThreads([contactId], !archived))}>
            {archived ? "Restore" : "Archive"}
          </button>
          <button type="button" role="menuitem" onClick={() => act(() => markThreadsSpam([contactId], !spam))}>
            {spam ? "Not spam" : "Mark spam"}
          </button>
        </div>
      </details>
      {hasPanel ? <ContactSheetButton /> : null}
      {err ? (
        <span className="os-ix-tact-err" role="alert">
          {err}
        </span>
      ) : null}
    </span>
  );
}

/** Narrow screens: today's contact panel as a bottom sheet. */
function ContactSheetButton() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const ix = document.querySelector<HTMLElement>(".os-ix");
    if (!ix) return;
    if (open) ix.dataset.sheet = "open";
    else delete ix.dataset.sheet;
    return () => {
      delete ix.dataset.sheet;
    };
  }, [open]);
  return (
    <>
      <button type="button" className="os-button os-ix-contact-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        Contact
      </button>
      {open ? <button type="button" className="os-ix-sheet-backdrop" aria-label="Close contact" onClick={() => setOpen(false)} /> : null}
    </>
  );
}
