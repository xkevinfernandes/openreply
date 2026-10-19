"use client";

// The campaign bar on the edit page: what the keyword sends (CampaignResource)
// and the setter hand-off (Off = automation only, or a setter takes over once
// they reply: lib/os/automations-handoff.ts).

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setCampaignHandoff, setCampaignResource, type AutomationActionResult } from "@/app/(os)/os/automations/actions";
import { InfoTip } from "@/components/os/ui";

interface Option {
  id: string;
  name: string;
}

interface Props {
  automationId: string;
  setters: Option[];
  /** "off" | "default" | a setter id. */
  selected: string;
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
  /** The "" option; omit when every choice is in options. */
  empty?: string;
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
          {empty !== undefined && <option value="">{empty}</option>}
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
        label="Sends"
        tip="The lead magnet this keyword delivers. Logged as sent on the contact."
        value={resourceId}
        empty="Match from the link"
        options={resources}
        save={(id) => setCampaignResource(automationId, id)}
      />
      <Picker
        label="Setter"
        tip="Off: the automation runs on its own. Pick a setter to take over once they reply."
        value={selected}
        options={[
          { id: "off", name: "Off (automation only)" },
          { id: "default", name: `Account default${defaultName ? ` (${defaultName})` : ""}` },
          ...setters,
        ]}
        save={(id) => setCampaignHandoff(automationId, id ?? "off")}
      />
    </section>
  );
}
