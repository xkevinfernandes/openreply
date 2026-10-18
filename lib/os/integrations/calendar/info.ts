// Copy for the Calendar & Scheduling cards. Pure (client components import it).
import type { CalendarProviderId } from "./types";

export const CALENDAR_INFO: Record<
  CalendarProviderId,
  { name: string; blurb: string; explain: string[]; tokenLabel: string; tokenHint: string; placeholder: string }
> = {
  calcom: {
    name: "Cal.com",
    blurb: "J offers real times from your Cal.com and books the call inside the DM. No link to click.",
    explain: [
      "When someone says yes to a call, J reads your free times, offers two in their timezone, takes the one they pick and asks for their email.",
      "The confirmation is a draft like any other: your Approve books it on Cal.com, then the message goes out. Cal.com sends them the calendar invite.",
      "J then asks for a screenshot of the invite. When it comes in, they move to Call booked and your CRM hears about it.",
    ],
    tokenLabel: "Cal.com API key",
    tokenHint: "Cal.com → Settings → Developer → API Keys → New. Starts with cal_live_. Tested, then encrypted, never shown again.",
    placeholder: "cal_live_…",
  },
  calendly: {
    name: "Calendly",
    blurb: "J offers real times from your Calendly and books the call inside the DM.",
    explain: [
      "When someone says yes to a call, J reads your free times, offers two in their timezone, takes the one they pick and asks for their email.",
      "Your Approve books it through Calendly's Scheduling API and Calendly sends the invite. That API needs a paid Calendly plan (Standard or above).",
      "On the Free plan Calendly refuses API bookings. J then sends a link that opens exactly the time they picked, with their name and email filled in.",
    ],
    tokenLabel: "Personal access token",
    tokenHint: "Calendly → Integrations & apps → API and webhooks → Personal access tokens → Generate. Tested, then encrypted, never shown again.",
    placeholder: "eyJ…",
  },
};

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
