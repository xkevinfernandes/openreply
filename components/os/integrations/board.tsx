"use client";

import { useState } from "react";
import type { CalendarBoard } from "@/lib/os/integrations/calendar/view";
import type { IntegrationView } from "@/lib/os/integrations/view";
import { PROVIDER_INFO, type IntegrationCategory } from "@/lib/os/integrations/view-info";
import CalendarCard from "./calendar-card";
import IntegrationCard from "./card";

type Category = IntegrationCategory | "calendar" | "all";

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "all", label: "All" },
  { id: "crm", label: "CRM & Contacts" },
  { id: "email", label: "Email Marketing" },
  { id: "calendar", label: "Calendar & Scheduling" },
];

export default function IntegrationsBoard({
  views,
  calendars,
  canManage,
  now,
}: {
  views: IntegrationView[];
  calendars: CalendarBoard;
  canManage: boolean;
  now: number;
}) {
  const [category, setCategory] = useState<Category>("all");
  // Only categories with something in them (spec: other categories hidden).
  const tabs = CATEGORIES.filter(
    (c) => c.id === "all" || (c.id === "calendar" ? calendars.calendars.length > 0 : views.some((v) => PROVIDER_INFO[v.provider].category === c.id))
  );
  const shown = views.filter((v) => category === "all" || PROVIDER_INFO[v.provider].category === category);
  const showCalendars = category === "all" || category === "calendar";

  return (
    <div className="os-int">
      <div className="os-tabs" role="tablist" aria-label="Category">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" className="os-tab" aria-selected={category === t.id} onClick={() => setCategory(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {!canManage && <p className="os-int-note">Only workspace owners and admins can connect or change integrations.</p>}
      <div className="os-int-grid">
        {shown.map((v) => (
          <IntegrationCard key={v.provider} view={v} canManage={canManage} now={now} />
        ))}
        {showCalendars &&
          calendars.calendars.map((v) => <CalendarCard key={v.provider} view={v} setters={calendars.setters} canManage={canManage} now={now} />)}
      </div>
      {showCalendars && calendars.sample && (
        <p className="os-int-note">Sample data (OS_MOCK): nothing is connected, so J books on a sample calendar. Connect one to use your real times.</p>
      )}
    </div>
  );
}
