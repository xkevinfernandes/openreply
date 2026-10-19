"use client";

// Activity tab: one timeline, newest first, grouped by day. Owner: S3.
import { useEffect, useState } from "react";
import { loadActivity } from "@/app/(os)/os/contacts/actions";
import { EmptyState, SetterMark } from "@/components/os/ui";
import type { ContactPanelData } from "@/lib/os/contact-panel/types";
import type { ActivityItem } from "@/lib/os/contacts-activity";

const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return DAY.format(d);
}

const ICON: Record<ActivityItem["kind"], string> = {
  keyword: "M3 5.5h10M3 10.5h10M6.5 2.5l-1 11M10.5 2.5l-1 11",
  conversation: "M2.5 4.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7l-3 2.5v-2.5h0a2 2 0 0 1-1.5-2z",
  lead_magnet: "M4 2.5h5.5L12 5v8.5H4zM9.5 2.5V5H12",
  offer: "M3 8h10M9.5 4.5 13 8l-3.5 3.5",
  booked: "M3 4.5h10v9H3zM3 7.5h10M6 2.5v3M10 2.5v3",
  showed: "m3.5 8.5 3 3 6-7",
  won: "M5 2.5h6v3a3 3 0 0 1-6 0zM8 8.5v3M5.5 13.5h5",
  field: "M3 12.5h3l7-7-3-3-7 7zM9 4l3 3",
  followup: "M8 13.8A5.8 5.8 0 1 0 8 2.2a5.8 5.8 0 0 0 0 11.6ZM8 4.8V8l2.2 1.4",
};

export default function ActivityTab({ data, items: initial }: { data: ContactPanelData; items?: ActivityItem[] | null }) {
  const [state, setState] = useState<{ id: string; items: ActivityItem[] } | { id: string; error: string } | null>(initial ? { id: data.contactId, items: initial } : null);

  useEffect(() => {
    if (state?.id === data.contactId) return;
    let live = true;
    loadActivity(data.contactId).then((r) => {
      if (live) setState("error" in r ? { id: data.contactId, error: r.error } : { id: data.contactId, items: r });
    });
    return () => {
      live = false;
    };
  }, [data.contactId, state?.id]);

  if (!state || state.id !== data.contactId) return <p className="os-cd-loading">Loading…</p>;
  if ("error" in state) return <p className="os-cd-loading">{state.error}</p>;
  if (!state.items.length) return <EmptyState title="No activity yet" />;

  const groups: { label: string; items: ActivityItem[] }[] = [];
  for (const it of state.items) {
    const label = dayLabel(it.at);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(it);
    else groups.push({ label, items: [it] });
  }

  return (
    <div className="os-ca">
      {groups.map((g) => (
        <section key={g.label} className="os-ca-day" aria-label={g.label}>
          <h2>{g.label}</h2>
          <ol>
            {g.items.map((it) => (
              <li key={it.id} data-kind={it.kind}>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d={ICON[it.kind]} />
                </svg>
                <span className="os-ca-text">
                  <span>{it.label}</span>
                  {it.detail ? <span className="os-ca-detail">{it.detail}</span> : null}
                </span>
                {it.by && it.by !== "OpenReply" ? <SetterMark name={it.by} title={`By ${it.by}`} /> : null}
                <time dateTime={it.at}>{TIME.format(new Date(it.at))}</time>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
