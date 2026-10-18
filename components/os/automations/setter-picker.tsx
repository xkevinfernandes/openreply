"use client";

// "Answered by": which knowledge base J uses for people who come in through
// this campaign. Writes our CampaignSetter table through the same server
// action as the knowledge base's Campaigns section.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { setCampaignSetter } from "@/app/(os)/os/knowledge/actions";
import { useSaver } from "@/components/os/knowledge/fields";

interface Props {
  automationId: string;
  setters: { id: string; name: string }[];
  selected: string | null;
  defaultName: string | null;
}

export default function SetterPicker({ automationId, setters, selected, defaultName }: Props) {
  const router = useRouter();
  const saver = useSaver();
  const [value, setValue] = useState(selected ?? "");

  return (
    <section className="os-auto-setterbar" aria-labelledby="os-auto-setter-label">
      <div>
        <strong id="os-auto-setter-label">Answered by</strong>
        <p>When someone from this campaign replies, J drafts with this knowledge base. A contact keeps its setter.</p>
      </div>
      {setters.length ? (
        <div className="os-auto-setterbar-control">
          <span className="os-select">
            <select
              aria-labelledby="os-auto-setter-label"
              value={value}
              disabled={saver.pending}
              onChange={(e) => {
                const next = e.target.value;
                setValue(next);
                saver.run(async () => {
                  const r = await setCampaignSetter(automationId, next || null);
                  router.refresh();
                  return r;
                });
              }}
            >
              <option value="">Account default{defaultName ? ` (${defaultName})` : ""}</option>
              {setters.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </span>
          {saver.note && (
            <span className="os-kb-note" data-kind={saver.note.kind} role={saver.note.kind === "error" ? "alert" : "status"}>
              {saver.note.text}
            </span>
          )}
        </div>
      ) : (
        <p className="os-auto-setterbar-empty">
          No knowledge base yet, so J uses the bundled files. <Link href="/os/knowledge">Set one up</Link>.
        </p>
      )}
    </section>
  );
}
