"use server";

// The All · funnel board's two drops (Won, Lost) and Home's "won with no
// amount" fill-in. They save through the Contacts writes (markContactsWon,
// updateContacts: the one stage writer, the won event's data, follow-ups and
// integrations), so a move here is the same as a move anywhere else. The
// Won picker is the offer-aware one (components/os/contacts/won-picker.tsx).
// OS_MOCK: filled-in amounts are kept in lib/os/mock-home.ts.

import { revalidatePath } from "next/cache";
import { markContactsWon, updateContacts } from "@/app/(os)/os/contacts/actions";
import { osMockEnabled } from "@/lib/os/mock";
import type { MarkWonResult } from "@/lib/os/won";
import { parsePrice } from "@/lib/os/won-offers";

function refresh() {
  revalidatePath("/os");
  revalidatePath("/os/pipeline/all");
  revalidatePath("/os/pipeline");
}

/**
 * Won on the All board, or the amount for a win already on Won (Home's
 * fill-in: the stage writer leaves it on Won and the amount is stored).
 * `wonAt` (mock sample only) keeps a filled-in win on its own date.
 */
export async function markFunnelWon(contactId: string, offer: string, amount: number | string, wonAt?: string): Promise<MarkWonResult> {
  const r = await markContactsWon([contactId], offer, amount);
  if (osMockEnabled() && !r.error) {
    // The sample has no won event log: keep the amount (and a fill-in's date) here.
    const n = parsePrice(amount);
    if (n !== null) (await import("@/lib/os/mock-home")).recordMockWonAmount(contactId, offer, n, wonAt ? new Date(wonAt) : new Date());
  }
  refresh();
  return r;
}

/** Drop on Lost (leaving Won clears the amount, in the writer). */
export async function markFunnelLost(contactId: string): Promise<{ error?: string }> {
  const r = await updateContacts([contactId], { type: "column", column: "lost" });
  if (osMockEnabled() && !r.error) (await import("@/lib/os/mock-home")).clearMockWonAmount(contactId);
  refresh();
  return r.error ? { error: r.error } : {};
}
