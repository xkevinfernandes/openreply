// Who connected what, when it was last checked, and the activity log
// (OsConnection / OsConnectionEvent). Never throws: a failed audit write must
// not break a connect, a disconnect or a send. Notes go through cleanNote, so
// no key or token is ever written here.
import { prisma } from "@/lib/db/client";
import { cleanNote } from "./catalog";

export type ConnectionEventKind = "connect" | "check" | "fail" | "disconnect" | "revoke_failed" | "deauthorized";

async function safe(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    console.warn("[connections] audit write failed:", err instanceof Error ? err.message : "unknown");
  }
}

export function logConnectionEvent(workspaceId: string, service: string, kind: ConnectionEventKind, opts: { actorId?: string | null; note?: unknown } = {}) {
  return safe(() =>
    prisma.osConnectionEvent.create({ data: { workspaceId, service, kind, actorId: opts.actorId ?? null, note: cleanNote(opts.note) } })
  );
}

/** A connect (or a key replaced): who and when, and the error cleared. */
export async function recordConnect(workspaceId: string, service: string, opts: { actorId?: string | null; account?: string | null } = {}) {
  const now = new Date();
  const account = cleanNote(opts.account, 120);
  await safe(() =>
    prisma.osConnection.upsert({
      where: { workspaceId_service: { workspaceId, service } },
      create: { workspaceId, service, connectedById: opts.actorId ?? null, connectedAt: now, account, lastCheckedAt: now, lastOkAt: now, lastError: null },
      update: { connectedById: opts.actorId ?? null, connectedAt: now, account, lastCheckedAt: now, lastOkAt: now, lastError: null },
    })
  );
  await logConnectionEvent(workspaceId, service, "connect", { actorId: opts.actorId, note: account });
}

/** A disconnect: the audit row goes; the event stays. A cleanup that failed at
 *  the provider is kept as its own "revoke_failed" row with the reason. */
export async function recordDisconnect(workspaceId: string, service: string, opts: { actorId?: string | null; revokeError?: unknown; note?: unknown } = {}) {
  await safe(() => prisma.osConnection.deleteMany({ where: { workspaceId, service } }));
  if (opts.revokeError) await logConnectionEvent(workspaceId, service, "revoke_failed", { actorId: opts.actorId, note: opts.revokeError });
  await logConnectionEvent(workspaceId, service, "disconnect", { actorId: opts.actorId, note: opts.note });
}

/** A live check's result. Manual checks are logged; automatic ones only when
 *  they fail, so the log isn't a wall of "checked". */
export async function recordCheck(
  workspaceId: string,
  service: string,
  result: { ok: boolean; error?: string | null; account?: string | null },
  opts: { actorId?: string | null; manual?: boolean } = {}
) {
  const now = new Date();
  const error = result.ok ? null : (cleanNote(result.error) ?? "The check failed.");
  const account = result.account ? cleanNote(result.account, 120) : undefined;
  await safe(() =>
    prisma.osConnection.upsert({
      where: { workspaceId_service: { workspaceId, service } },
      create: { workspaceId, service, lastCheckedAt: now, lastOkAt: result.ok ? now : null, lastError: error, ...(account ? { account } : {}) },
      update: { lastCheckedAt: now, lastError: error, ...(result.ok ? { lastOkAt: now } : {}), ...(account ? { account } : {}) },
    })
  );
  if (!result.ok) await logConnectionEvent(workspaceId, service, "fail", { actorId: opts.actorId, note: error });
  else if (opts.manual) await logConnectionEvent(workspaceId, service, "check", { actorId: opts.actorId, note: account ?? null });
}
