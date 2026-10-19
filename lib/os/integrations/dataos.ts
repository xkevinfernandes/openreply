// The Data OS card on Settings › Integrations (Content). Data OS is an
// external system reached over HTTP (base URL + token), never tables copied
// in. Storage lives in lib/os/dataos/store.ts (one store for the card and the
// media worker); this file only checks what was typed.
import { disconnectDataOs as disconnect, getDataOsConnection, writeDataOsConnection, type DataOsConnection } from "@/lib/os/dataos/store";

export { DATAOS_PROVIDER } from "@/lib/os/dataos/store";

export type DataOsView = DataOsConnection;

/** A base URL as stored: https, no trailing slash. */
export function cleanBaseUrl(raw: unknown): { url: string } | { error: string } {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return { error: "Paste the Data OS address." };
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") return { error: "Use an https address." };
    return { url: u.toString().replace(/\/+$/, "") };
  } catch {
    return { error: "That isn't an address." };
  }
}

export function dataOsView(workspaceId: string): Promise<DataOsView> {
  return getDataOsConnection(workspaceId);
}

/** Save the address and (optionally new) token. An empty token keeps the old one. */
export async function saveDataOs(workspaceId: string, input: { baseUrl: unknown; token?: unknown }): Promise<{ ok: true } | { error: string }> {
  const url = cleanBaseUrl(input.baseUrl);
  if ("error" in url) return url;
  const token = typeof input.token === "string" ? input.token.trim() : "";
  if (token.length > 500) return { error: "That token is too long." };
  await writeDataOsConnection(workspaceId, { baseUrl: url.url, token: token || null });
  return { ok: true };
}

export function disconnectDataOs(workspaceId: string): Promise<void> {
  return disconnect(workspaceId);
}
