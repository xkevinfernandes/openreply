"use server";

// The All · funnel board's two drops (Won, Lost) and Home's "won with no
// amount" fill-in. Moves go through the one stage writer as Kevin's (cause
// "user"); the amount lands in the won event's data (lib/os/events.ts).

import { revalidatePath } from "next/cache";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { setWonData } from "@/lib/os/events";
import { osMockEnabled } from "@/lib/os/mock";
import { writeStage } from "@/lib/os/stage-writer";

export interface WonInput {
  offer: string;
  amount: number;
  /** ISO date or date-time. */
  wonAt: string;
}

async function requireWorkspace() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) throw new Error("Sign in again.");
  return workspaceId;
}

function parseWon(input: WonInput): { offer: string; amount: number; wonAt: Date } | { error: string } {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < 0) return { error: "Add the amount." };
  const wonAt = new Date(input.wonAt);
  if (Number.isNaN(wonAt.getTime())) return { error: "Pick the date." };
  if (wonAt.getTime() > Date.now() + 86_400_000) return { error: "That date is in the future." };
  return { offer: (input.offer ?? "").trim(), amount, wonAt };
}

function refresh() {
  revalidatePath("/os");
  revalidatePath("/os/pipeline/all");
  revalidatePath("/os/pipeline");
}

async function move(workspaceId: string, contactId: string, column: "won" | "lost"): Promise<{ error?: string }> {
  const r = await writeStage({ workspaceId, contactId, cause: "user", change: { type: "column", column } });
  if (r.status === "refused" || r.status === "missing") return { error: r.reason };
  if (r.status === "applied" && !osMockEnabled()) {
    const { fireContactEvent } = await import("@/lib/os/integrations/events");
    await fireContactEvent({ workspaceId, contactId, event: "stage_changed" }).catch(() => null);
  }
  return {};
}

/** Drop on Won: the picker's offer, amount and date. */
export async function markFunnelWon(contactId: string, input: WonInput): Promise<{ error?: string }> {
  const workspaceId = await requireWorkspace();
  const won = parseWon(input);
  if ("error" in won) return won;
  if (osMockEnabled()) {
    const m = await import("@/lib/os/mock-home");
    if (m.isMockHomeContact(contactId)) {
      m.recordMockFunnelMove(contactId, { stage: "WON", wonAmount: won.amount, wonAt: won.wonAt, offer: won.offer });
      refresh();
      return {};
    }
  }
  const r = await move(workspaceId, contactId, "won");
  if (r.error) return r;
  if (osMockEnabled()) (await import("@/lib/os/mock-home")).recordMockWonAmount(contactId, won.offer, won.amount, won.wonAt);
  else await setWonData({ workspaceId, contactId, offer: won.offer, amount: won.amount, wonAt: won.wonAt });
  refresh();
  return {};
}

/** Drop on Lost (leaving Won clears the amount, in the writer). */
export async function markFunnelLost(contactId: string): Promise<{ error?: string }> {
  const workspaceId = await requireWorkspace();
  if (osMockEnabled()) {
    const m = await import("@/lib/os/mock-home");
    if (m.isMockHomeContact(contactId)) {
      m.recordMockFunnelMove(contactId, { stage: "LOST", wonAmount: null, wonAt: null, offer: "" });
      refresh();
      return {};
    }
    const r = await move(workspaceId, contactId, "lost");
    if (!r.error) m.recordMockFunnelMove(contactId, { stage: "LOST", wonAmount: null, wonAt: null, offer: "" });
    refresh();
    return r;
  }
  const r = await move(workspaceId, contactId, "lost");
  refresh();
  return r;
}

/** Home's "won with no amount": add the amount to a win already on Won. */
export async function fillWonAmount(contactId: string, input: WonInput): Promise<{ error?: string }> {
  const workspaceId = await requireWorkspace();
  const won = parseWon(input);
  if ("error" in won) return won;
  if (osMockEnabled()) (await import("@/lib/os/mock-home")).recordMockWonAmount(contactId, won.offer, won.amount, won.wonAt);
  else await setWonData({ workspaceId, contactId, offer: won.offer, amount: won.amount, wonAt: won.wonAt });
  refresh();
  return {};
}
