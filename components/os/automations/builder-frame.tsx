"use client";

// OpenReply's campaign builder (components/campaign-builder.tsx), unchanged,
// inside the DM OS. Two things are ours:
//  - Its router is wrapped so the places it sends you back to ("/campaigns",
//    "/campaigns/<id>") land on /os/automations instead of the old dashboard.
//    Same router otherwise; only the href is rewritten.
//  - .os-builder in automations.css restyles its Tailwind classes to the
//    Review Room look.

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import CampaignBuilder from "@/components/campaign-builder";
import { osHrefForUpstream } from "@/lib/os/upstream-routes";

export default function BuilderFrame({ mode, campaignId }: { mode: "new" | "edit"; campaignId?: string }) {
  const router = useRouter();
  const wrapped = useMemo<AppRouterInstance>(
    () => ({
      ...router,
      push: (href, options) => router.push(osHrefForUpstream(href), options),
      replace: (href, options) => router.replace(osHrefForUpstream(href), options),
      prefetch: (href, options) => router.prefetch(osHrefForUpstream(href), options),
    }),
    [router]
  );
  return (
    <div className="os-builder">
      <AppRouterContext.Provider value={wrapped}>
        <CampaignBuilder mode={mode} campaignId={campaignId} />
      </AppRouterContext.Provider>
    </div>
  );
}
