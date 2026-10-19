"use client";

// Panel sections shared by the Details tab (and later the Inbox). Owner: F.
import { InfoTip, SetterMark } from "@/components/os/ui";
import type { ContactPanelData } from "@/lib/os/contact-panel/types";

/** Key fields (dl). J's values carry the J marker. Shared by Details. */
export function PanelFields({ data }: { data: ContactPanelData }) {
  if (!data.fields.length) return null;
  const byJ = data.fields.some((f) => f.byJ);
  return (
    <section className="os-panel-section" aria-labelledby={`pf-${data.contactId}`}>
      <h3 id={`pf-${data.contactId}`}>
        Fields
        {byJ ? <InfoTip label="Filled by J from the chat">Values with a J were filled by the setter from the chat.</InfoTip> : null}
      </h3>
      <dl className="os-panel-fields">
        {data.fields.map((f) => (
          <div key={f.key} data-empty={f.value ? undefined : true}>
            <dt>{f.label}</dt>
            <dd>
              {f.value ?? "—"}
              {f.byJ ? <SetterMark name={data.setter?.name ?? "J"} title="Filled by J from the chat" /> : null}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Keywords triggered → resource, with the date. */
export function PanelKeywords({ data }: { data: ContactPanelData }) {
  if (!data.keywords.length) return null;
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");
  return (
    <section className="os-panel-section" aria-labelledby={`pk-${data.contactId}`}>
      <h3 id={`pk-${data.contactId}`}>Keywords</h3>
      <ul className="os-panel-keywords">
        {data.keywords.map((k, i) => (
          <li key={`${k.word}-${i}`} title={k.title ?? undefined} data-surface={k.surface}>
            <span className="os-panel-kw">{k.word}</span>
            {k.resource ? <span className="os-panel-kw-res">{k.resource}</span> : <span className="os-panel-kw-res" />}
            <span className="os-panel-kw-date">{date(k.at)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
