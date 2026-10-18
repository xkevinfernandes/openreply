"use client";

// J's triage in the Inbox (spec item 7): the suggestion under an Unsorted
// thread, the "Move to Sales?" flag on a Personal one, and the Unsorted bar
// (Sort with J, Confirm all). J only suggests; every move is one tap.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  confirmAllSuggestions,
  confirmSuggestion,
  dismissSuggestion,
  setContactKind,
  sortWithJ,
  type TriageActionResult,
} from "@/app/(os)/os/inbox/actions";
import type { ContactKind } from "@/app/generated/prisma/enums";
import { TRIAGE_DISABLED_NOTICE, triageCopy } from "@/lib/os/triage-copy";

interface SuggestionProps {
  contactId: string;
  /** The contact's kind now: UNSORTED (a guess) or PERSONAL (a flag). */
  kind: ContactKind;
  /** Null with a confidence: J looked but isn't sure. */
  suggestedKind: ContactKind | null;
  /** Jev's probability, shown as a quiet percentage. Null from the LLM. */
  confidence?: number | null;
  reason: string | null;
  /** "row" sits under a thread in the list; "banner" under the thread head. */
  variant?: "row" | "banner";
  /** Called the moment a choice is tapped (true), so the list can let go of
   *  the row at once; called again with false if the move failed. */
  onDecided?: (contactId: string, decided: boolean) => void;
}

export function TriageSuggestion({ contactId, kind, suggestedKind, confidence = null, reason, variant = "row", onDecided }: SuggestionProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const flag = kind === "PERSONAL";
  const unsure = !suggestedKind;
  const other: ContactKind = suggestedKind === "SALES" ? "PERSONAL" : "SALES";
  const copy = triageCopy({ flag, suggested: suggestedKind === "UNSORTED" ? null : suggestedKind, confidence, reason });

  function run(act: () => Promise<TriageActionResult | void>) {
    setError(null);
    onDecided?.(contactId, true);
    startTransition(async () => {
      try {
        const r = await act();
        if (r && r.error) {
          setError(r.error);
          onDecided?.(contactId, false);
        }
      } catch {
        setError("That didn't save. Try again.");
        onDecided?.(contactId, false);
      }
      router.refresh();
    });
  }

  return (
    <div
      className="os-triage"
      data-variant={variant}
      data-flag={flag ? "true" : undefined}
      data-unsure={unsure ? "true" : undefined}
      aria-busy={pending}
    >
      <p className="os-triage-text">
        <span className="os-triage-mark" aria-hidden="true">
          J
        </span>
        <span className="os-triage-label">{copy.label}</span>
        {copy.pct && <span className="os-triage-pct"> · {copy.pct}</span>}
        {copy.detail && <span className="os-triage-reason"> · {copy.detail}</span>}
      </p>
      {unsure ? (
        <div className="os-triage-actions" role="group" aria-label="Sales or personal?">
          <button type="button" className="os-button" disabled={pending} onClick={() => run(() => setContactKind(contactId, "SALES"))}>
            Sales
          </button>
          <button type="button" className="os-button" disabled={pending} onClick={() => run(() => setContactKind(contactId, "PERSONAL"))}>
            Personal
          </button>
        </div>
      ) : (
        <div className="os-triage-actions" role="group" aria-label={flag ? "Move to Sales?" : "J's suggestion"}>
          <button type="button" className="os-button primary" disabled={pending} onClick={() => run(() => confirmSuggestion(contactId))}>
            {flag ? "Move to Sales" : `Confirm ${suggestedKind === "SALES" ? "Sales" : "Personal"}`}
          </button>
          <button
            type="button"
            className="os-button"
            disabled={pending}
            onClick={() => run(() => (flag ? dismissSuggestion(contactId) : setContactKind(contactId, other)))}
          >
            {flag ? "Keep personal" : other === "SALES" ? "Sales" : "Personal"}
          </button>
        </div>
      )}
      {error && (
        <p className="os-triage-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

interface BarProps {
  unsortedCount: number;
  suggestedCount: number;
  /** Called when Confirm all is tapped (true), so the list can let go of
   *  those rows; false if it failed. */
  onConfirmAll?: (on: boolean) => void;
  /** Triage can't run here (production without Jev): no Sort button, just why. */
  disabled?: boolean;
}

export function TriageBar({ unsortedCount, suggestedCount, onConfirmAll, disabled = false }: BarProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"sort" | "confirm" | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  function run(which: "sort" | "confirm") {
    setMessage(null);
    setBusy(which);
    if (which === "confirm") onConfirmAll?.(true);
    startTransition(async () => {
      try {
        const r = which === "sort" ? await sortWithJ() : await confirmAllSuggestions();
        setMessage(r.error ? { text: r.error, error: true } : r.notice ? { text: r.notice } : null);
        if (r.error && which === "confirm") onConfirmAll?.(false);
      } catch {
        if (which === "confirm") onConfirmAll?.(false);
        setMessage({ text: "That didn't go through. Try again.", error: true });
      }
      setBusy(null);
      router.refresh();
    });
  }

  if (!unsortedCount && !message) return null;

  return (
    <div className="os-triage-bar" aria-busy={pending}>
      <div className="os-triage-bar-actions">
        {!disabled && (
          <button type="button" className="os-button" disabled={pending || !unsortedCount} onClick={() => run("sort")}>
            {busy === "sort" ? "J is sorting…" : "Sort with J"}
          </button>
        )}
        <button
          type="button"
          className="os-button primary"
          disabled={pending || !suggestedCount}
          onClick={() => run("confirm")}
          aria-label={`Confirm all suggestions (${suggestedCount})`}
        >
          Confirm all{suggestedCount ? <span className="count"> {suggestedCount}</span> : null}
        </button>
      </div>
      <p className="os-triage-bar-note" aria-live="polite" data-error={message?.error ? "true" : undefined}>
        {message?.text ?? (disabled ? TRIAGE_DISABLED_NOTICE : suggestedCount ? "Check J's guesses, then confirm in one go." : "J reads each thread and guesses sales or personal.")}
      </p>
    </div>
  );
}
