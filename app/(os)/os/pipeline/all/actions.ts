"use server";

// The All · funnel board's two drops (Won, Lost) and Home's "won with no
// amount" fill-in. They save through the Contacts writes (markContactsWon,
// updateContacts: the one stage writer, the won event's data, follow-ups and
// integrations), so a move here is the same as a move anywhere else. The
// Won picker is the offer-aware one (components/os/contacts/won-picker.tsx).
// OS_MOCK only: Home's synthetic funnel people live in lib/os/mock-home.ts.

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
  if (osMockEnabled()) {
    const m = await import("@/lib/os/mock-home");
    const n = parsePrice(amount);
    const at = wonAt ? new Date(wonAt) : new Date();
    if (m.isMockHomeContact(contactId)) {
      if (n === null) return { error: "Type the amount." };
      m.recordMockFunnelMove(contactId, { stage: "WON", wonAmount: n, wonAt: at, offer });
      refresh();
      return { count: 1, refused: [] };
    }
    const r = await markContactsWon([contactId], offer, amount);
    if (!r.error && n !== null) m.recordMockWonAmount(contactId, offer, n, at);
    refresh();
    return r;
  }
  const r = await markContactsWon([contactId], offer, amount);
  refresh();
  return r;
}

/** Drop on Lost (leaving Won clears the amount, in the writer). */
export async function markFunnelLost(contactId: string): Promise<{ error?: string }> {
  const mock = osMockEnabled() ? await import("@/lib/os/mock-home") : null;
  if (mock?.isMockHomeContact(contactId)) {
    mock.recordMockFunnelMove(contactId, { stage: "LOST", wonAmount: null, wonAt: null, offer: "" });
    refresh();
    return {};
  }
  const r = await updateContacts([contactId], { type: "column", column: "lost" });
  if (!r.error) mock?.recordMockFunnelMove(contactId, { stage: "LOST", wonAmount: null, wonAt: null, offer: "" });
  refresh();
  return r.error ? { error: r.error } : {};
}
