// Copy for the Integrations cards. Pure, so client components can import it.
import type { SyncProviderId } from "./mapping";

export type IntegrationCategory = "crm" | "email";

export const PROVIDER_INFO: Record<SyncProviderId, { name: string; category: IntegrationCategory; blurb: string; explain: string[] }> = {
  kit: {
    name: "Kit",
    category: "email",
    blurb: "Add people who give you their email to your Kit list, with their stage and tags.",
    explain: [
      "When someone gives their email in a DM, they become a Kit subscriber. Campaign email gates already did this; now stage, tags and your custom fields come along too.",
      "When you change their stage or tags here, Kit is updated within seconds. Kit needs an email, so people who never gave one stay out.",
      "One way only: edits made in Kit never come back to DM OS.",
    ],
  },
  ghl: {
    name: "GoHighLevel",
    category: "crm",
    blurb: "Send your Instagram leads to a GoHighLevel sub-account as contacts, tagged and staged.",
    explain: [
      "Each sales contact becomes a GoHighLevel contact: first name, Instagram handle, email once they give it, stage and tags.",
      "Your custom fields (their goal, business, what they've tried…) fill GoHighLevel custom fields, and stages can move an opportunity through a pipeline.",
      "Pushed when an email is captured or the stage, tags or type change. One way only: edits made in GoHighLevel never come back.",
    ],
  },
};
