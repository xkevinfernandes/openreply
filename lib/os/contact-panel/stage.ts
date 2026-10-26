// The panel's stage dropdown (dm-crm issue 020): the moves the move table
// allows for this contact now, read through the stage writer's own storage
// (the same state the writer decides on), plus the won offer and amount.

import { formatMoney } from "@/lib/os/money";
import { columnOf, moveTargets } from "@/lib/os/move-table";
import { osMockEnabled } from "@/lib/os/mock";
import { prismaStageDb, type StageDb } from "@/lib/os/stage-writer";
import { wonAmounts, workspaceCurrency } from "@/lib/os/won";
import type { PanelStageExtras } from "@/lib/os/contact-panel/types";

async function stageDb(): Promise<StageDb> {
  if (osMockEnabled()) return (await import("@/lib/os/stage-writer-mock")).mockStageDb();
  return prismaStageDb;
}

export async function panelStageExtras(workspaceId: string, contactId: string): Promise<(PanelStageExtras & { column: string }) | null> {
  const db = await stageDb();
  const state = await db.run((tx) => tx.lock(workspaceId, contactId));
  if (!state) return null;
  const targets = moveTargets(state);
  let won: PanelStageExtras["won"] = null;
  if (state.stage === "WON") {
    const [w, currency] = await Promise.all([wonAmounts(workspaceId, [contactId]), workspaceCurrency(workspaceId)]);
    const d = w.get(contactId);
    won = d ? { offer: d.offer, amount: formatMoney(d.amount, currency) } : { offer: "", amount: null };
  }
  return { column: columnOf(state), targets, won };
}
