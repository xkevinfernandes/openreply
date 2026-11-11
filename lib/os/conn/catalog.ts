// Settings › Connections: every service the DM OS talks to, in words. Pure (no
// database, no env), so the board, the view model and the tests share it.
//
// method: "oauth" signs in on the provider's page, "key" is a pasted key kept
// encrypted (ENCRYPTION_KEY), "managed" is a key Kevin sets on the server
// (Railway / Doppler) and is never changed from this screen.

export type ServiceId =
  | "instagram"
  | "zernio"
  | "kit"
  | "ghl"
  | "calcom"
  | "calendly"
  | "dataos"
  | "anthropic"
  | "openrouter"
  | "openai"
  | "email"
  | "redis";

export type ServiceMethod = "oauth" | "key" | "managed";

export interface ServiceScope {
  label: string;
  detail?: string;
}

export interface ServiceInfo {
  id: ServiceId;
  name: string;
  /** What the DM OS uses it for, one line. */
  purpose: string;
  category: string;
  /** A brand logo id (ConnectionLogo), or none for the initial. */
  logo?: string;
  method: ServiceMethod;
  scopes: ServiceScope[];
  never: string[];
  /** One connection the apps use together. */
  shared?: boolean;
  usedBy?: string[];
  /** Where the key lives on the provider's side (to find it, or delete it). */
  keyHelpHref?: string;
  /** What stops when it's disconnected, for the red confirm. */
  consequence?: string;
}

export const APP_NAME = "DM OS";

export const SERVICES: readonly ServiceInfo[] = [
  {
    id: "instagram",
    name: "Instagram",
    purpose: "Comments, DMs and story replies come in and go out through this account",
    category: "Messaging",
    logo: "instagram",
    method: "oauth",
    scopes: [
      { label: "Read your profile and post insights", detail: "instagram_business_basic, instagram_business_manage_insights" },
      { label: "Read and answer comments", detail: "instagram_business_manage_comments" },
      { label: "Read DMs and send the replies you approve or automate", detail: "instagram_business_manage_messages" },
    ],
    never: ["See your Instagram password", "Post to your feed or stories", "Follow, unfollow or like for you"],
    consequence:
      "Instagram has no way for an app to revoke its own token, so we unsubscribe our webhook and delete the token. To remove the app completely, open Instagram → Settings → Apps and websites. Automations and J stop replying until you reconnect.",
  },
  {
    id: "zernio",
    name: "Zernio",
    purpose: "Sends and reads Instagram DMs without your own Meta app",
    category: "Messaging",
    method: "key",
    scopes: [
      { label: "Read and send Instagram DMs and comments through Zernio's inbox" },
      { label: "Register one webhook so new messages reach J", detail: "comment.received, message.received, message.read" },
    ],
    never: ["Post content for you", "Change your Zernio plan or billing"],
    shared: true,
    usedBy: ["DM OS", "Client portal", "DataOS"],
    consequence: "We delete our webhook at Zernio first. Disconnect the Zernio Instagram accounts before this.",
  },
  {
    id: "kit",
    name: "Kit",
    purpose: "Captured emails and tags sync to your Kit list",
    category: "CRM & email",
    logo: "kit",
    method: "key",
    scopes: [
      { label: "Add subscribers and update their fields" },
      { label: "Apply and remove tags" },
      { label: "Read your custom fields, for the mapping" },
    ],
    never: ["Send a broadcast or an email", "Delete subscribers"],
    shared: true,
    usedBy: ["DM OS", "Sales Pages"],
    keyHelpHref: "https://app.kit.com/account_settings/developer_settings",
    consequence: "Nothing more syncs to Kit. Your field mapping is kept.",
  },
  {
    id: "ghl",
    name: "GoHighLevel",
    purpose: "Contacts, fields and pipeline stages sync to your GHL location",
    category: "CRM & email",
    method: "key",
    scopes: [
      { label: "Create and update contacts in one location" },
      { label: "Set custom fields and the pipeline stage" },
    ],
    never: ["Send SMS or email from GHL", "Delete contacts"],
    consequence: "Nothing more is sent to GoHighLevel. Delete the private integration token in GHL to retire it. Your mapping is kept.",
  },
  {
    id: "calcom",
    name: "Cal.com",
    purpose: "J offers live times and books the call",
    category: "Calendar",
    method: "key",
    scopes: [
      { label: "Read your event types and free times" },
      { label: "Book the call you approve" },
      { label: "Register a webhook for cancels, reschedules and no-shows" },
    ],
    never: ["See your Cal.com password", "Delete your event types"],
    keyHelpHref: "https://app.cal.com/settings/developer/api-keys",
    consequence: "We delete our webhook at Cal.com. J sends your booking link again. Your calendar settings are kept.",
  },
  {
    id: "calendly",
    name: "Calendly",
    purpose: "Booking link or live times",
    category: "Calendar",
    logo: "calendly",
    method: "key",
    scopes: [
      { label: "Read your event types and free times" },
      { label: "Book the call you approve" },
      { label: "Register a webhook for cancels, reschedules and no-shows" },
    ],
    never: ["See your Calendly password", "Delete your event types"],
    keyHelpHref: "https://calendly.com/integrations/api_webhooks",
    consequence: "We delete our webhook subscription at Calendly. J sends your booking link again. Your calendar settings are kept.",
  },
  {
    id: "dataos",
    name: "Data OS",
    purpose: "Stories and content J can point at",
    category: "Content",
    method: "key",
    scopes: [{ label: "Read your stories and posts" }, { label: "Receive DM events for your reports" }],
    never: ["Post content for you"],
    consequence: "J stops seeing which story a reply is about.",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    purpose: "Claude writes J's drafts and describes images",
    category: "AI",
    logo: "anthropic",
    method: "managed",
    scopes: [{ label: "Send conversation text and images to Claude for a draft" }],
    never: ["Train on your data (API terms)"],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    purpose: "Jev sorts the inbox; media fallback",
    category: "AI",
    method: "managed",
    scopes: [{ label: "Send message text to the sorting model" }],
    never: [],
  },
  {
    id: "openai",
    name: "OpenAI",
    purpose: "Transcribes voice notes",
    category: "AI",
    method: "managed",
    scopes: [{ label: "Send voice notes for transcription" }],
    never: [],
  },
  {
    id: "email",
    name: "Email",
    purpose: "Sign-in links",
    category: "Email",
    logo: "resend",
    method: "managed",
    scopes: [{ label: "Send the sign-in link to whoever signs in" }],
    never: ["Email your contacts"],
  },
  {
    id: "redis",
    name: "Job queue",
    purpose: "Sends, drafts and syncs run through it",
    category: "Infrastructure",
    method: "managed",
    scopes: [{ label: "Hold the jobs the worker runs" }],
    never: [],
  },
];

export const SERVICE_IDS = SERVICES.map((s) => s.id);

export function serviceInfo(id: string): ServiceInfo | null {
  return SERVICES.find((s) => s.id === id) ?? null;
}

export function isServiceId(id: unknown): id is ServiceId {
  return typeof id === "string" && SERVICES.some((s) => s.id === id);
}

/** Notes go into the activity log and onto the page: words only. Anything
 *  that looks like a token (a long unbroken run) is cut out. */
export function cleanNote(raw: unknown, max = 200): string | null {
  if (raw == null) return null;
  const text = String(raw instanceof Error ? raw.message : raw)
    .replace(/(bearer|token|key|secret|password)\s*[:=]\s*\S+/gi, "$1 [hidden]")
    .replace(/[A-Za-z0-9_\-+/=.]{24,}/g, "[hidden]")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The last four characters of a key, the most that ever leaves the server. */
export function last4(key: string | null | undefined): string | undefined {
  const k = (key ?? "").replace(/\s/g, "");
  return k.length >= 8 ? k.slice(-4) : undefined;
}
