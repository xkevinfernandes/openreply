"use client";

// The campaign bar on the edit page: which lead magnet the keyword hands out
// (CampaignResource) and which setter answers when they reply (CampaignSetter).

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setCampaignResource, setCampaignSetter, type AutomationActionResult } from "@/app/(os)/os/automations/actions";
import { InfoTip } from "@/components/os/ui";

interface Option {
  id: string;
  name: string;
}

interface Props {
  automationId: string;
  setters: Option[];
  selected: string | null;
  defaultName: string | null;
  resources: Option[];
  resourceId: string | null;
}

function Picker({
  label,
  tip,
  value,
  empty,
  options,
  save,
}: {
  label: string;
  tip: string;
  value: string | null;
  empty: string;
  options: Option[];
  save: (v: string | null) => Promise<AutomationActionResult>;
}) {
  const router = useRouter();
  const [v, setV] = useState(value ?? "");
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <label className="os-auto-pick">
      <span className="os-auto-pick-label">
        {label}
        <InfoTip>{tip}</InfoTip>
      </span>
      <span className="os-select">
        <select
          value={v}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.value;
            setV(next);
            setNote(null);
            start(async () => {
              const r = await save(next || null);
              setNote(r.error ? { kind: "error", text: r.error } : { kind: "ok", text: "Saved" });
              router.refresh();
            });
          }}
        >
          <option value="">{empty}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </span>
      {note && (
        <span className="os-auto-pick-note" data-kind={note.kind} role={note.kind === "error" ? "alert" : "status"}>
          {note.text}
        </span>
      )}
    </label>
  );
}

export default function SetterPicker({ automationId, setters, selected, defaultName, resources, resourceId }: Props) {
  return (
    <section className="os-auto-bar" aria-label="Campaign">
      <Picker
        label="Lead magnet"
        tip="What this keyword hands out. Counted as a lead magnet sent; shown on the contact. Empty = worked out from the link."
        value={resourceId}
        empty="From the link"
        options={resources}
        save={(id) => setCampaignResource(automationId, id)}
      />
      <Picker
        label="Setter"
        tip="Who drafts when they reply. A contact keeps its setter."
        value={selected}
        empty={`Account default${defaultName ? ` (${defaultName})` : ""}`}
        options={setters}
        save={(id) => setCampaignSetter(automationId, id)}
      />
    </section>
  );
}
