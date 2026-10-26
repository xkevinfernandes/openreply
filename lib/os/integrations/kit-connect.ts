// Kit's key: connect, replace and disconnect through the existing
// /api/crm/kit route (shared with campaign email gates). Pure apart from the
// fetch it's handed, so the messages are testable without Kit.

export type KitKeyResult = { ok: true; notice: string } | { ok: false; error: string };

export const KIT_REFUSED = "Kit didn't accept that key";
export const KIT_UNREACHABLE = "Couldn't reach Kit · try again";
export const KIT_CONNECTED = "Connected · nothing synced yet";
export const KIT_REPLACED = "Key replaced";
export const KIT_DISCONNECTED = "Kit disconnected";
export const KIT_DISCONNECT_CONFIRM = "Disconnect Kit? Nothing more syncs. Your field mapping is kept.";

type FetchLike = (input: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** The words for a refused or failed answer from /api/crm/kit. */
export function kitError(status: number, error: string | null | undefined): string {
  const e = error ?? "";
  if (/invalid|can't access|paste your kit api key/i.test(e) || status === 400) return KIT_REFUSED;
  if (/didn't respond/i.test(e) || status >= 500) return KIT_UNREACHABLE;
  return e || KIT_UNREACHABLE;
}

/** Connect (or replace, when a key is already saved) and disconnect. A
 *  refused replacement leaves the old key in place: the route only saves a
 *  key Kit accepted. */
export async function kitKeyRequest(fetchFn: FetchLike, method: "POST" | "DELETE", opts: { apiKey?: string; replacing?: boolean } = {}): Promise<KitKeyResult> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchFn("/api/crm/kit", {
      method,
      headers: { "Content-Type": "application/json" },
      ...(method === "POST" ? { body: JSON.stringify({ apiKey: opts.apiKey ?? "" }) } : {}),
    });
  } catch {
    return { ok: false, error: KIT_UNREACHABLE };
  }
  const p = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
  if (!res.ok || !p?.success) return { ok: false, error: kitError(res.status, p?.error) };
  if (method === "DELETE") return { ok: true, notice: KIT_DISCONNECTED };
  return { ok: true, notice: opts.replacing ? KIT_REPLACED : KIT_CONNECTED };
}
