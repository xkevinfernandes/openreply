"use client";

import { useState } from "react";
import type { IntegrationView } from "@/lib/os/integrations/view";
import { PROVIDER_INFO, type IntegrationCategory } from "@/lib/os/integrations/view-info";
import IntegrationCard from "./card";

const CATEGORIES: { id: IntegrationCategory | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "crm", label: "CRM & Contacts" },
  { id: "email", label: "Email Marketing" },
];

export default function IntegrationsBoard({ views, canManage, now }: { views: IntegrationView[]; canManage: boolean; now: number }) {
  const [category, setCategory] = useState<IntegrationCategory | "all">("all");
  // Only categories with something in them (spec: other categories hidden).
  const tabs = CATEGORIES.filter((c) => c.id === "all" || views.some((v) => PROVIDER_INFO[v.provider].category === c.id));
  const shown = views.filter((v) => category === "all" || PROVIDER_INFO[v.provider].category === category);

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
      </div>
    </div>
  );
}
