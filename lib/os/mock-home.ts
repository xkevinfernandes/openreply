// OS_MOCK=1: the Won amounts filled in on Home's funnel and the All · funnel
// board. Home and the All board count the same sample people as every other
// screen (lib/os/mock.ts via crm-funnel's mockFunnelContacts), so each person
// sits in one column everywhere. In memory on globalThis like the rest of the
// mock; gone on restart.

import type { FunnelContact } from "@/lib/os/crm-funnel";

const DAY = 86_400_000;

interface MockWin {
  wonAmount: number;
  wonAt: Date;
  offer: string;
}

const mem = ((globalThis as { __osMockFunnelWins?: Map<string, MockWin> }).__osMockFunnelWins ??= new Map());

/** When a sample win happened: its filled-in date, else the sample's (3 days ago, as mockFunnelContacts). */
export function mockWonAt(contactId: string, now: Date): Date {
  return mem.get(contactId)?.wonAt ?? new Date(now.getTime() - 3 * DAY);
}

export function recordMockWonAmount(contactId: string, offer: string, amount: number, wonAt: Date) {
  mem.set(contactId, { wonAmount: amount, wonAt, offer });
}

/** Leaving Won forgets the amount (like the writer clearing the won event's data). */
export function clearMockWonAmount(contactId: string) {
  mem.delete(contactId);
}

/** The amounts filled in, on top of the sample (stages come from the stage writer's mock). */
export function applyMockFunnelMoves(contacts: FunnelContact[]): FunnelContact[] {
  return contacts.map((c) => {
    const m = mem.get(c.id);
    return m && c.stage === "WON" ? { ...c, wonAmount: m.wonAmount, wonAt: m.wonAt } : c;
  });
}
