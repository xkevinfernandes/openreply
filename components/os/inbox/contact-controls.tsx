"use client";

import { useTransition } from "react";
import { setOnFriday } from "@/app/(os)/os/follow-ups/actions";
import { setContactKind, setContactStage } from "@/app/(os)/os/inbox/actions";
import type { ContactKind, ContactStage } from "@/app/generated/prisma/enums";
import { kindTabs, stageLabels, stageOrder } from "@/lib/os/labels";

interface ContactControlsProps {
  contactId: string;
  kind: ContactKind;
  stage: ContactStage;
  /** On the Follow-up Friday list. */
  onFriday?: boolean;
}

export default function ContactControls({ contactId, kind, stage, onFriday = false }: ContactControlsProps) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="os-contact-controls" aria-busy={pending}>
      <div className="os-segmented" role="group" aria-label="Conversation type">
        {kindTabs.map((k) => (
          <button
            key={k.kind}
            type="button"
            aria-pressed={k.kind === kind}
            disabled={pending}
            onClick={() => startTransition(() => setContactKind(contactId, k.kind))}
          >
            {k.label}
          </button>
        ))}
      </div>
      {kind === "SALES" && (
        <label className="os-select">
          <span className="sr-only">Stage</span>
          <select
            id={`stage-${contactId}`}
            value={stage}
            disabled={pending}
            onChange={(e) => {
              const next = e.target.value as ContactStage;
              startTransition(() => setContactStage(contactId, next));
            }}
          >
            {stageOrder.map((s) => (
              <option key={s} value={s}>
                {stageLabels[s]}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        className="os-button os-friday-toggle"
        aria-pressed={onFriday}
        disabled={pending}
        title={onFriday ? "On the Follow-up Friday list. Click to take them off." : "Add to the Follow-up Friday list"}
        onClick={() => startTransition(async () => void (await setOnFriday(contactId, !onFriday)))}
      >
        {onFriday ? "On Friday" : "Add to Friday"}
      </button>
    </div>
  );
}
