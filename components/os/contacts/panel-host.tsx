"use client";

// The push panel beside Contacts and Pipeline: today's contact panel (its
// tabs unchanged) with the resizer and a close button. Remembers the last
// tab and keeps ?c= / ?tab= in the URL.

import { useCallback, useEffect, useState, useTransition } from "react";
import { loadPanel } from "@/app/(os)/os/contacts/actions";
import ActivityTab from "@/components/os/contact-panel/activity-tab";
import DetailsTab from "@/components/os/contact-panel/details-tab";
import ContactPanel from "@/components/os/contact-panel/panel";
import PanelResizer from "@/components/os/contact-panel/resizer";
import type { ContactDetailsData } from "@/lib/os/contact-panel/details";
import type { ContactPanelData, PanelTab } from "@/lib/os/contact-panel/types";
import { CONTACT_MOVED_EVENT } from "@/components/os/contact-panel/stage-control";

export interface OpenPanel {
  panel: ContactPanelData;
  details: ContactDetailsData;
}

/** Replace ?c= / ?tab= without a navigation. */
export function syncPanelUrl(next: { c?: string | null; tab?: PanelTab | null }) {
  const url = new URL(window.location.href);
  if (next.c !== undefined) {
    if (next.c) url.searchParams.set("c", next.c);
    else url.searchParams.delete("c");
    url.searchParams.delete("contact");
  }
  if (next.tab !== undefined) {
    if (next.tab && next.tab !== "chat") url.searchParams.set("tab", next.tab);
    else url.searchParams.delete("tab");
  }
  window.history.replaceState(null, "", url);
}

export default function PanelHost({ open, tab, onTab, onClose }: { open: OpenPanel; tab: PanelTab; onTab: (t: PanelTab) => void; onClose: () => void }) {
  return (
    <div
      className="os-cx-panel"
      onClickCapture={(e) => {
        // The panel keeps its tab in local state: remember the last pick so
        // the next contact opens on it, and put it in the URL.
        const el = (e.target as HTMLElement).closest<HTMLElement>(".os-panel [role=tab]");
        const label = el?.textContent?.trim().toLowerCase().replace(/[^a-z]/g, "") ?? "";
        const key = (["chat", "details", "followups", "activity"] as const).find((k) => label.startsWith(k));
        if (key) {
          onTab(key);
          syncPanelUrl({ tab: key });
        }
      }}
    >
      <PanelResizer />
      <button type="button" className="os-cx-close" aria-label="Close panel" title="Close panel" onClick={onClose}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 4 8 8M12 4l-8 8" />
        </svg>
      </button>
      <ContactPanel
        key={open.panel.contactId}
        data={open.panel}
        tab={tab}
        slots={{
          details: <DetailsTab data={open.panel} details={open.details} />,
          activity: <ActivityTab data={open.panel} />,
        }}
      />
    </div>
  );
}

/** Open / reload / close the panel; reloads it when the panel itself moved a stage. */
export function usePanel(initialOpen: OpenPanel | null, initialTab: PanelTab, onError: (text: string) => void) {
  const [open, setOpen] = useState<OpenPanel | null>(initialOpen);
  const [tab, setTab] = useState<PanelTab>(initialTab);
  const [, start] = useTransition();

  const reload = useCallback(
    (id: string) => {
      start(async () => {
        const r = await loadPanel(id).catch(() => ({ error: "The panel didn't load." }));
        if ("error" in r) onError(r.error);
        else setOpen((o) => (o?.panel.contactId === id ? r : o));
      });
    },
    [onError]
  );

  const show = useCallback(
    (id: string) => {
      syncPanelUrl({ c: id });
      start(async () => {
        const r = await loadPanel(id).catch(() => ({ error: "The panel didn't load." }));
        if ("error" in r) onError(r.error);
        else setOpen(r);
      });
    },
    [onError]
  );

  const close = useCallback(() => {
    setOpen(null);
    syncPanelUrl({ c: null, tab: null });
  }, []);

  const openId = open?.panel.contactId ?? null;
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<{ contactId?: string }>).detail?.contactId;
      if (id && id === openId) reload(id);
    };
    window.addEventListener(CONTACT_MOVED_EVENT, on);
    return () => window.removeEventListener(CONTACT_MOVED_EVENT, on);
  }, [openId, reload]);

  return { open, openId, tab, setTab, show, reload, close };
}
