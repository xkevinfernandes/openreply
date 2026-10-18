"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { approveJDraft, discardJDraft } from "@/app/(os)/os/inbox/actions";
import type { DraftView } from "@/lib/os/setter/store";

const KIND_LABEL: Record<string, string> = {
  reply: "Reply",
  value_opener: "Opener",
  nudge: "Nudge",
  invite: "Invitation",
};

/** Flags that mean "read this one carefully" (spec item 9). */
const FLAG_LABEL: Record<string, { label: string; title: string }> = {
  human_agent: { label: "Outside 24h", title: "Sends under Meta's HUMAN_AGENT tag. Only approve if you'd send it yourself right now." },
  invite: { label: "Invitation", title: "J thinks it's time to invite them. You pick the route." },
  unqualified: { label: "Not fully qualified", title: "J couldn't quote their goal and challenge yet. Consider discarding." },
  price: { label: "Mentions price", title: "Price or payment in the draft. Check it's allowed in DMs." },
  sample: { label: "Sample draft", title: "Written by the fake drafter, not a model. Set ANTHROPIC_API_KEY or OS_DRAFTER." },
};

interface DraftCardProps {
  draft: DraftView;
  username: string | null;
  regenerating: boolean;
  onEdit: () => void;
  onRegenerate: () => void;
  onError: (message: string | null) => void;
}

export default function DraftCard({ draft, username, regenerating, onEdit, onRegenerate, onError }: DraftCardProps) {
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
          {KIND_LABEL[draft.kind] ?? "Draft"} for @{username ?? "them"}
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
            ? draft.bubbles.length > 1
              ? `Sending ${draft.bubbles.length} bubbles…`
              : "Sending…"
            : draft.bubbles.length > 1
              ? `Approve & send ${draft.bubbles.length}`
              : "Approve & send"}
        </button>
      </div>
    </section>
  );
}
