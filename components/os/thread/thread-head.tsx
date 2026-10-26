"use client";

// The conversation head (InboxA): who, the stage pill, a one-tap triage chip
// when J has a guess, and the 24h reply window. Stage editing lives in the
// contact panel. Owner: S1.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { confirmSuggestion, dismissSuggestion } from "@/app/(os)/os/inbox/actions";
import type { ContactKind } from "@/app/generated/prisma/enums";
import { kindTabs } from "@/lib/os/labels";

interface ThreadHeadProps {
  name: string;
  username: string | null;
  backHref: string;
  stage: string | null;
  /** The stage's funnel column key; picks the pill tone (booked/showed/won good, lost bad). */
  stageKey?: string | null;
  /** Hours left in Meta's window after their last message (null: unknown). */
  windowHours: number | null;
  triage: { contactId: string; kind: ContactKind; suggestedKind: ContactKind } | null;
  /** The inbox's thread actions (star, Mark unread, archive, spam, Contact). */
  actions?: React.ReactNode;
}

const kindLabel = (k: ContactKind) => kindTabs.find((t) => t.kind === k)?.label ?? k;

const GOOD_COLUMNS = new Set(["booked", "showed", "won"]);
const stageTone = (key: string | null | undefined) => (key && GOOD_COLUMNS.has(key) ? "good" : key === "lost" ? "bad" : "neutral");

export default function ThreadHead({ name, username, backHref, stage, stageKey, windowHours, triage, actions }: ThreadHeadProps) {
  return (
    <header className="os-th-head">
      <Link href={backHref} className="os-th-back" aria-label="Back to threads">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 3.5 5.5 8l4.5 4.5" />
        </svg>
      </Link>
      {username ? (
        <a className="os-th-name" href={`https://instagram.com/${username}`} target="_blank" rel="noreferrer">
          {name}
        </a>
      ) : (
        <span className="os-th-name">{name}</span>
      )}
      {stage ? <span className="os-th-stage" data-tone={stageTone(stageKey)}>{stage}</span> : null}
      {triage ? <TriageChip {...triage} /> : null}
      <span className="os-cmp-sp" />
      {windowHours !== null ? (
        <span className="os-th-window" data-closed={windowHours === 0 || undefined} title={windowHours ? `24h reply window: ${windowHours}h left` : "24h reply window closed"}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
            <circle cx="8" cy="8" r="5.8" />
            <path d="M8 5v3l2 1.5" />
          </svg>
          {windowHours ? `${windowHours}h` : "Closed"}
        </span>
      ) : null}
      {actions}
    </header>
  );
}

/** J's guess as one tap: "→ Sales" moves them, × keeps them where they are. */
function TriageChip({ contactId, kind, suggestedKind }: { contactId: string; kind: ContactKind; suggestedKind: ContactKind }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [gone, setGone] = useState(false);
  if (gone) return null;
  const act = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      setGone(true);
      const r = await fn().catch(() => ({ error: "failed" }));
      if (r.error) setGone(false);
      router.refresh();
    });
  return (
    <span className="os-th-triage" aria-busy={pending || undefined}>
      <button type="button" className="os-th-triage-go" title={`J thinks this is ${kindLabel(suggestedKind)}`} onClick={() => act(() => confirmSuggestion(contactId))}>
        Move to {kindLabel(suggestedKind)}
      </button>
      {kind === "PERSONAL" ? (
        <button type="button" className="os-th-triage-x" aria-label={`Keep in ${kindLabel(kind)}`} title={`Keep in ${kindLabel(kind)}`} onClick={() => act(() => dismissSuggestion(contactId))}>
          ×
        </button>
      ) : null}
    </span>
  );
}
