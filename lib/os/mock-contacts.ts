// S3 sample data for OS_MOCK: field values, sync state, lead magnets and
// activity for the sample contacts (Maya as on the ContactsD board). Custom
// fields themselves come from the DB even in mock mode. In memory; gone on restart.
import type { FieldValueSource } from "@/lib/os/fields/types";
import { mockContactExtras, updateMockContactExtras } from "@/lib/os/mock";

export interface MockFieldValue {
  value: string;
  source: FieldValueSource | "instagram";
  at: string;
}

const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();

const seedValues: Record<string, Record<string, MockFieldValue>> = {
  c1: {
    first_name: { value: "Maya", source: "instagram", at: daysAgo(2) },
    email: { value: "maya@mayabuilds.co", source: "import", at: daysAgo(2) },
    business: { value: "Notion template shop", source: "j", at: daysAgo(2) },
    monthly_revenue: { value: "~$4k/mo", source: "j", at: daysAgo(3) },
    their_goal: { value: "Automate DM replies", source: "j", at: daysAgo(3) },
    their_challenge: { value: "40-60 DMs a week, same two questions", source: "j", at: daysAgo(0) },
  },
  c3: {
    business: { value: "Ops agency", source: "j", at: daysAgo(1) },
    their_goal: { value: "Book more discovery calls", source: "j", at: daysAgo(1) },
  },
  c8: { monthly_revenue: { value: "$40k/mo", source: "j", at: daysAgo(2) } },
};

const g = globalThis as { __osMockFieldValues?: Record<string, Record<string, MockFieldValue>>; __osMockContactsSeeded?: boolean };
const values = (g.__osMockFieldValues ??= structuredClone(seedValues));

/** Maya's Kit tags as on the board (once per process). */
function ensureSeed() {
  if (g.__osMockContactsSeeded) return;
  g.__osMockContactsSeeded = true;
  updateMockContactExtras("c1", { tags: ["setter-starter", "dm-script-vault", "setter-j"], email: mockContactExtras("c1").email ?? "maya@mayabuilds.co" });
}

export function mockFieldValues(contactId: string): Record<string, MockFieldValue> {
  ensureSeed();
  return (values[contactId] ??= {});
}

export function setMockFieldValue(contactId: string, key: string, value: string | null, source: FieldValueSource = "user") {
  const row = mockFieldValues(contactId);
  if (value == null) delete row[key];
  else row[key] = { value, source, at: new Date().toISOString() };
}

export interface MockLeadMagnet {
  name: string;
  via: "openreply" | "setter";
  at: string;
}

const leadMagnets: Record<string, MockLeadMagnet[]> = {
  c1: [
    { name: "Claude Code Setter Starter", via: "openreply", at: daysAgo(2) },
    { name: "DM Script Vault", via: "setter", at: daysAgo(1) },
  ],
  c2: [{ name: "Claude Code Setter Starter", via: "openreply", at: daysAgo(0.1) }],
};

export function mockLeadMagnets(contactId: string): MockLeadMagnet[] {
  return leadMagnets[contactId] ?? [];
}

/** Kit synced a moment ago; GoHighLevel isn't connected. */
export function mockSync(contactId: string) {
  return { kit: { state: contactId === "c1" ? ("synced" as const) : ("waiting" as const), at: contactId === "c1" ? new Date(Date.now() - 2 * 60_000).toISOString() : null } };
}

/** One-line notes on the board cards. */
export const MOCK_CARD_NOTES: Record<string, string> = {
  c1: "Notion shop, ~$4k/mo, automate DMs",
  c2: "agency owner, replied to SETTER",
  c3: "offered Tue 2pm / Wed 11am",
  c6: "call Thu 3:00pm",
  c8: "no-show, rebook queued",
  c9: "Setter Build · $3.5k",
};

/** Contacts with a follow-up queued. */
export const MOCK_FOLLOWUPS = new Set(["c1", "c6", "c8", "c11"]);

/** The keyword or surface each sample contact came in on. */
export const MOCK_SOURCES: Record<string, string> = { c1: "SETTER", c2: "SETTER", c3: "SETTER", c6: "SCRIPT", c8: "SETTER", c9: "SETTER" };
