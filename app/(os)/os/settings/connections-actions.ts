"use server";

// Settings › Connections: "Check now" and the check on opening the page. A
// live, read-only call per service (lib/os/conn/health.ts); nothing is sent.
// Connect and disconnect keep their own routes and actions (Kit, Zernio,
// Instagram, calendars, GoHighLevel, Data OS), which now also write the audit.
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { recordCheck } from "@/lib/os/conn/audit";
import { isServiceId, SERVICES, type ServiceId } from "@/lib/os/conn/catalog";
import { checkService } from "@/lib/os/conn/health";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

export type CheckOutcome = { ok: true; account?: string } | { ok: false; error: string };

async function requireManager() {
  const context = await getCurrentWorkspaceContext();
  if (!context) throw new Error("Sign in again.");
  if (!canManageWorkspace(context.role)) throw new Error("Only workspace owners and admins can check connections.");
  return context;
}

/** Keep the older screens (Diagnostics, the settings list) in step. */
async function mirror(workspaceId: string, id: ServiceId, error: string | null) {
  if (!["kit", "ghl", "calcom", "calendly", "dataos"].includes(id)) return;
  await prisma.osIntegration
    .updateMany({ where: { workspaceId, provider: id }, data: { lastTestedAt: new Date(), lastError: error } })
    .catch(() => {});
}

async function runCheck(workspaceId: string, id: ServiceId, actorId: string, manual: boolean): Promise<CheckOutcome | null> {
  const r = await checkService(workspaceId, id);
  if (r.absent) return null;
  await recordCheck(workspaceId, id, { ok: r.ok, error: r.error, account: r.account }, { actorId, manual });
  await mirror(workspaceId, id, r.ok ? null : (r.error ?? "The check failed."));
  return r.ok ? { ok: true, ...(r.account ? { account: r.account } : {}) } : { ok: false, error: r.error ?? "The check failed." };
}

export async function checkConnection(id: string): Promise<CheckOutcome> {
  try {
    const ctx = await requireManager();
    if (!isServiceId(id)) return { ok: false, error: "Unknown connection." };
    const r = await runCheck(ctx.workspaceId, id, ctx.userId, true);
    revalidatePath("/os/settings");
    return r ?? { ok: false, error: "It isn't connected." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 200) : "The check failed." };
  }
}

const STALE_MS = 15 * 60_000;

/** On opening the page: re-check what's connected and hasn't been checked in
 *  the last 15 minutes. Only failures are logged. */
export async function checkStale(): Promise<{ checked: number }> {
  try {
    const ctx = await requireManager();
    const rows = await prisma.osConnection.findMany({ where: { workspaceId: ctx.workspaceId }, select: { service: true, lastCheckedAt: true } });
    const fresh = new Set(rows.filter((r) => r.lastCheckedAt && Date.now() - r.lastCheckedAt.getTime() < STALE_MS).map((r) => r.service));
    const due = SERVICES.map((s) => s.id).filter((id) => !fresh.has(id));
    const results = await Promise.all(due.map((id) => runCheck(ctx.workspaceId, id, ctx.userId, false).catch(() => null)));
    const checked = results.filter(Boolean).length;
    if (checked) revalidatePath("/os/settings");
    return { checked };
  } catch {
    return { checked: 0 };
  }
}
