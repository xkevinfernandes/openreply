"use client";

// The contact panel (InboxA right pane, ContactsA/D push panel). Owner: F.
// Head: who, open in Instagram, stage pill, setter, next follow-up. Then the
// tabs Chat · Details · Follow-ups · Activity; each tab's body comes from its
// stream (slots), with a wave-0 stub as the default.
// Changing the stage emits "move-stage" on the event bus (components/os/keys.ts);
// the screen hosting the panel performs it.

import Link from "next/link";
import { useState } from "react";
import ActivityTab from "@/components/os/contact-panel/activity-tab";
import ChatTab from "@/components/os/contact-panel/chat-tab";
import DetailsTab from "@/components/os/contact-panel/details-tab";
import FollowupsTab from "@/components/os/contact-panel/followups-tab";
import InspectSlot from "@/components/os/inspect/inspect-slot";
import StageControl from "@/components/os/contact-panel/stage-control";
import { RunLine } from "@/components/os/workflows/run-line";
import { Avatar, SetterMark, Tabs } from "@/components/os/ui";
import { PANEL_TABS, type ContactPanelData, type PanelTab } from "@/lib/os/contact-panel/types";

const IG = "M5 2.5h6A2.5 2.5 0 0 1 13.5 5v6a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5ZM8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM11.3 4.7v.1";

export interface ContactPanelProps {
  data: ContactPanelData;
  /** Initial tab (the Inbox opens on Details: the chat is already in the middle). */
  tab?: PanelTab;
  /** URL-driven tabs; without it the tab is local state. */
  tabHref?: (tab: PanelTab) => string;
  /** A tab's body from its stream. Missing slots use the wave-0 stubs. */
  slots?: Partial<Record<PanelTab, React.ReactNode>>;
  /** Hide tabs the host already shows (the Inbox hides Chat). */
  hideTabs?: PanelTab[];
}

/** The panel, or J's brain (Inspect) in its place while a draft is inspected. */
export default function ContactPanel(props: ContactPanelProps) {
  return (
    <InspectSlot>
      <PanelBody {...props} />
    </InspectSlot>
  );
}

function PanelBody({ data, tab = "details", tabHref, slots = {}, hideTabs = [] }: ContactPanelProps) {
  const [local, setLocal] = useState<PanelTab>(tab);
  const current = tabHref ? tab : local;
  const tabs = PANEL_TABS.filter((t) => !hideTabs.includes(t.key));
  const name = data.fullName ?? data.username ?? "Unknown";

  const body: Record<PanelTab, React.ReactNode> = {
    chat: slots.chat ?? <ChatTab data={data} />,
    details: slots.details ?? <DetailsTab data={data} />,
    followups: slots.followups ?? <FollowupsTab data={data} />,
    activity: slots.activity ?? <ActivityTab data={data} />,
  };

  return (
    <aside className="os-panel" aria-label="Contact">
      <div className="os-panel-head">
        <div className="os-panel-who">
          <Avatar name={name} src={data.avatarUrl} size={40} />
          <div className="os-panel-names">
            <span className="os-panel-name">{name}</span>
            {data.username ? <span className="os-panel-handle">@{data.username}</span> : null}
          </div>
          {data.username ? (
            <a className="os-icon-btn" href={`https://instagram.com/${data.username}`} target="_blank" rel="noreferrer" aria-label="Open in Instagram" title="Open in Instagram">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d={IG} />
              </svg>
            </a>
          ) : null}
        </div>

        <div className="os-panel-stage">
          <StageControl data={data} />
          {data.setter ? (
            <span className="os-panel-setter" title={`Setter: ${data.setter.name}`}>
              <SetterMark name={data.setter.name} title={`Setter: ${data.setter.name}`} />
              {data.setter.name}
            </span>
          ) : null}
        </div>

        <RunLine contactId={data.contactId} />

        {data.nextFollowup ? (
          <Link className="os-panel-next" href={data.nextFollowup.href} title={data.nextFollowup.tip ?? undefined}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 13.8A5.8 5.8 0 1 0 8 2.2a5.8 5.8 0 0 0 0 11.6ZM8 4.8V8l2.2 1.4" />
            </svg>
            <span>{data.nextFollowup.label}</span>
          </Link>
        ) : null}
      </div>

      <Tabs
        tabs={tabs}
        value={current}
        ariaLabel="Contact sections"
        size="sm"
        hrefFor={tabHref ? (k) => tabHref(k as PanelTab) : undefined}
        onChange={tabHref ? undefined : (k) => setLocal(k as PanelTab)}
      />
      <div className="os-panel-body" role="tabpanel">
        {body[current]}
      </div>
    </aside>
  );
}
