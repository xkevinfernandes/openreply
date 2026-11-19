// View-only inboxes (/os/view): a client's Instagram DMs, read with the
// client's own Zernio key (OsViewInbox), so Kevin can see them. Just see them.
//
// Read-only by construction, not by a flag someone can flip:
// - The key lives only on OsViewInbox, never on ZernioConnection or an
//   InstagramAccount row. Every send, draft, workflow, setter (J), triage,
//   keyword, broadcast, follow-up and webhook path loads its key from those
//   two, so none of them can reach this account.
// - No webhook is registered on the client's key, so no event about their
//   account ever reaches the worker.
// - This module is the only code that decrypts the key, and its one HTTP
//   function sends GET and nothing else (no method parameter), to three
//   read paths only, one at a time per key, within Zernio's rate limits.
//   Tests pin all of this (__tests__/os/view-inbox.test.ts).
// - Opening a thread here marks nothing read and writes nothing to our
//   database: no Contact, no OsEvent, no draft.

import { decryptToken } from "@/lib/meta/oauth";
import { parseZernioMessages } from "@/lib/os/messages/parse";
import type { RichMessage } from "@/lib/os/messages/types";

const ZERNIO = "https://zernio.com/api/v1";

export interface ViewInboxRow {
  id: string;
  workspaceId: string;
  label: string;
  apiKey: string;
  zernioAccountId: string;
  username: string;
}

export interface ViewThread {
  conversationId: string;
  username: string | null;
  name: string | null;
  avatarUrl: string | null;
  updatedTime: string | null;
  preview: string | null;
  unreadCount: number;
}

export interface ViewPage<T> {
  rows: T[];
  cursor: string | null;
}

type FetchRes = { ok: boolean; status: number; headers?: { get(name: string): string | null }; json(): Promise<unknown> };
type FetchLike = (url: string, init: { method: "GET"; headers: Record<string, string>; cache: "no-store"; signal: AbortSignal }) => Promise<FetchRes>;

export class ViewInboxError extends Error {
  constructor(public status: number, message?: string) {
    super(message ?? `Zernio read failed (HTTP ${status})`);
    this.name = "ViewInboxError";
  }
}

/** The only reads allowed: the conversation list, one conversation's messages,
 *  and the account list (the add script's check). Anything else is refused
 *  before a request is made. */
const READ_PATHS = [/^\/inbox\/conversations\?/, /^\/inbox\/conversations\/[^/?]+\/messages\?/, /^\/accounts(\?|$)/];

export function isAllowedReadPath(path: string): boolean {
  return READ_PATHS.some((r) => r.test(path));
}

// --- Zernio limits (a client's key, free tier: 60 reads/min) -----------------
// - One request at a time per key (a page never fires reads in parallel).
// - X-Ratelimit-Remaining/Reset (epoch seconds) are read on every response; at
//   <= 2 left we wait for the reset if it is close, else refuse with a
//   "try again in Ns" message instead of spending the last calls.
// - 429: the key is blocked until Reset / Retry-After; reads are refused (no
//   retry loop) until then.
// - 402 (payment / free tier): hard stop for that key until the process
//   restarts, never retried.
// - Connection reset / timeout / 502-504: at most 3 attempts, with backoff.
// - Responses are cached per key + path for 60s, so paging back and forth or
//   reloading does not spend reads.

export const VIEW_LIMITS = { attempts: 3, backoffMs: 500, lowWater: 2, maxWaitMs: 5_000, cacheTtlMs: 60_000, cacheMax: 200 };

type KeyState = { queue: Promise<unknown>; stopped: boolean; blockedUntil: number; remaining: number | null; resetAt: number };
const keyState = new Map<string, KeyState>();
const cache = new Map<string, { at: number; value: unknown }>();
let sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let now = () => Date.now();

/** Tests only: reset state and swap the clock / sleep. */
export function __resetViewLimits(deps: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {}) {
  keyState.clear();
  cache.clear();
  sleep = deps.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  now = deps.now ?? (() => Date.now());
}

function stateOf(apiKey: string): KeyState {
  let st = keyState.get(apiKey);
  if (!st) keyState.set(apiKey, (st = { queue: Promise.resolve(), stopped: false, blockedUntil: 0, remaining: null, resetAt: 0 }));
  return st;
}

const rateLimited = (ms: number) => new ViewInboxError(429, `Zernio rate limit reached; try again in ${Math.max(1, Math.ceil(ms / 1000))}s`);

const stopped402 = () => new ViewInboxError(402, "Zernio refused this key (HTTP 402, payment required); stopped, not retried until restart");

function noteHeaders(st: KeyState, res: FetchRes) {
  const h = res.headers;
  if (!h) return;
  const rem = Number(h.get("x-ratelimit-remaining"));
  const reset = Number(h.get("x-ratelimit-reset"));
  if (h.get("x-ratelimit-remaining") !== null && Number.isFinite(rem)) st.remaining = rem;
  if (h.get("x-ratelimit-reset") !== null && Number.isFinite(reset)) st.resetAt = reset * 1000;
}

function blockFor(st: KeyState, res: FetchRes): number {
  const retryAfter = Number(res.headers?.get("retry-after"));
  const until = Number.isFinite(retryAfter) && retryAfter > 0 ? now() + retryAfter * 1000 : st.resetAt > now() ? st.resetAt : now() + 60_000;
  st.blockedUntil = until;
  return until - now();
}

async function oneRead<T>(apiKey: string, path: string, fetchFn: FetchLike): Promise<T> {
  const st = stateOf(apiKey);
  if (st.stopped) throw stopped402();
  if (st.blockedUntil > now()) throw rateLimited(st.blockedUntil - now());
  if (st.remaining !== null && st.remaining <= VIEW_LIMITS.lowWater && st.resetAt > now()) {
    const wait = st.resetAt - now();
    if (wait > VIEW_LIMITS.maxWaitMs) throw rateLimited(wait);
    await sleep(wait);
    st.remaining = null;
  }
  for (let attempt = 1; ; attempt++) {
    let res: FetchRes;
    try {
      res = await fetchFn(`${ZERNIO}${path}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      // Connection reset, DNS, timeout: retry with backoff, at most 3 attempts.
      if (attempt >= VIEW_LIMITS.attempts) throw new ViewInboxError(502, "Couldn't reach Zernio (tried 3 times)");
      await sleep(VIEW_LIMITS.backoffMs * 2 ** (attempt - 1));
      continue;
    }
    noteHeaders(st, res);
    // Never surface the body: Zernio error bodies can carry credentials.
    if (res.status === 402) {
      st.stopped = true;
      throw stopped402();
    }
    if (res.status === 429) throw rateLimited(blockFor(st, res));
    if ([502, 503, 504].includes(res.status) && attempt < VIEW_LIMITS.attempts) {
      await sleep(VIEW_LIMITS.backoffMs * 2 ** (attempt - 1));
      continue;
    }
    if (!res.ok) throw new ViewInboxError(res.status);
    return (await res.json()) as T;
  }
}

/** GET only. There is deliberately no method argument. Serial per key, cached
 *  60s, rate-limit aware (see above). */
export async function viewGet<T>(apiKey: string, path: string, fetchFn: FetchLike = fetch as unknown as FetchLike): Promise<T> {
  if (!isAllowedReadPath(path)) throw new Error("View-only inbox: path not allowed");
  const ck = `${apiKey}\u0000${path}`;
  const hit = cache.get(ck);
  if (hit && now() - hit.at < VIEW_LIMITS.cacheTtlMs) return hit.value as T;
  const st = stateOf(apiKey);
  const run = st.queue.then(() => oneRead<T>(apiKey, path, fetchFn));
  st.queue = run.catch(() => undefined);
  const value = await run;
  if (cache.size >= VIEW_LIMITS.cacheMax) cache.delete(cache.keys().next().value as string);
  cache.set(ck, { at: now(), value });
  return value;
}

type ViewDb = {
  osViewInbox: {
    findMany(args: { where: { workspaceId: string }; orderBy: { createdAt: "asc" }; select: { id: true; label: true; username: true } }): Promise<{ id: string; label: string; username: string }[]>;
    findFirst(args: { where: { id: string; workspaceId: string } }): Promise<ViewInboxRow | null>;
  };
};

async function defaultDb(): Promise<ViewDb> {
  const { prisma } = await import("@/lib/db/client");
  return prisma as unknown as ViewDb;
}

/** The workspace's view-only inboxes (no keys). */
export async function listViewInboxes(workspaceId: string, db?: ViewDb) {
  return (db ?? (await defaultDb())).osViewInbox.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
    select: { id: true, label: true, username: true },
  });
}

/** One inbox, only if it belongs to this workspace. */
export async function loadViewInbox(workspaceId: string, id: string, db?: ViewDb): Promise<ViewInboxRow | null> {
  return (db ?? (await defaultDb())).osViewInbox.findFirst({ where: { id, workspaceId } });
}

function keyOf(row: ViewInboxRow, decrypt: (s: string) => string): string {
  return decrypt(row.apiKey);
}

/** One page per request, one request per click: the list is never walked to
 *  the end and only the opened thread's messages are read. */
export const VIEW_PAGE_SIZE = 50;
const cleanCursor = (c: string | null) => (c && c.length <= 512 ? c : null);

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** One page of threads, newest first. */
export async function viewThreads(
  row: ViewInboxRow,
  cursor: string | null = null,
  deps: { fetchFn?: FetchLike; decrypt?: (s: string) => string } = {},
): Promise<ViewPage<ViewThread>> {
  const params = new URLSearchParams({ accountId: row.zernioAccountId, limit: String(VIEW_PAGE_SIZE), ...(cleanCursor(cursor) ? { cursor: cleanCursor(cursor)! } : {}) });
  const page = await viewGet<{ data?: Record<string, unknown>[]; pagination?: { hasMore?: boolean; nextCursor?: string } }>(
    keyOf(row, deps.decrypt ?? decryptToken),
    `/inbox/conversations?${params}`,
    deps.fetchFn,
  );
  const rows = (page.data ?? [])
    .filter((c) => str(c.id))
    .map((c) => ({
      conversationId: String(c.id),
      username: str(c.participantUsername),
      name: str(c.participantName),
      avatarUrl: str(c.participantPicture),
      updatedTime: str(c.updatedTime),
      preview: str(c.lastMessage),
      unreadCount: typeof c.unreadCount === "number" ? c.unreadCount : 0,
    }));
  const next = page.pagination?.hasMore && page.pagination.nextCursor ? page.pagination.nextCursor : null;
  return { rows, cursor: next };
}

/** One page of a conversation, oldest first. */
export async function viewMessages(
  row: ViewInboxRow,
  conversationId: string,
  cursor: string | null = null,
  deps: { fetchFn?: FetchLike; decrypt?: (s: string) => string } = {},
): Promise<ViewPage<RichMessage>> {
  const params = new URLSearchParams({ accountId: row.zernioAccountId, limit: String(VIEW_PAGE_SIZE), sortOrder: "desc", ...(cleanCursor(cursor) ? { cursor: cleanCursor(cursor)! } : {}) });
  const page = await viewGet<{ messages?: unknown[]; data?: unknown[]; pagination?: { hasMore?: boolean; nextCursor?: string } }>(
    keyOf(row, deps.decrypt ?? decryptToken),
    `/inbox/conversations/${encodeURIComponent(conversationId)}/messages?${params}`,
    deps.fetchFn,
  );
  const next = page.pagination?.hasMore && page.pagination.nextCursor ? page.pagination.nextCursor : null;
  return { rows: parseZernioMessages(page.messages ?? page.data ?? []), cursor: next };
}

// --- Adding one (scripts/os-view-inbox-add.ts) -------------------------------

type AddDb = {
  workspace: { findUnique(args: { where: { id: string }; select: { id: true } }): Promise<{ id: string } | null> };
  instagramAccount: { findFirst(args: { where: { zernioAccountId: string }; select: { id: true } }): Promise<{ id: string } | null> };
  osViewInbox: {
    upsert(args: {
      where: { workspaceId_zernioAccountId: { workspaceId: string; zernioAccountId: string } };
      create: { workspaceId: string; label: string; apiKey: string; zernioAccountId: string; username: string };
      update: { label: string; apiKey: string; username: string };
      select: { id: true };
    }): Promise<{ id: string }>;
  };
};

/** Check the key reads that Instagram account (GET /accounts), refuse an
 *  account DM OS already acts on, then store the key encrypted. Registers no
 *  webhook and creates no ZernioConnection or InstagramAccount row. */
export async function addViewInbox(
  input: { workspaceId: string; label: string; zernioAccountId: string; apiKey: string },
  deps: { db: AddDb; encrypt: (s: string) => string; fetchFn?: FetchLike },
): Promise<{ id: string; username: string }> {
  const { db } = deps;
  if (!input.apiKey) throw new Error("No Zernio key on stdin");
  if (!(await db.workspace.findUnique({ where: { id: input.workspaceId }, select: { id: true } }))) throw new Error("No such workspace");
  // An account with an InstagramAccount row can be sent from; a view-only
  // inbox must never share an account with one.
  if (await db.instagramAccount.findFirst({ where: { zernioAccountId: input.zernioAccountId }, select: { id: true } }))
    throw new Error("That Zernio account is already connected to a DM OS workspace; refusing to add it as view-only");
  const res = await viewGet<{ accounts?: Record<string, unknown>[] }>(input.apiKey, "/accounts", deps.fetchFn);
  const acc = (res.accounts ?? []).find((a) => a._id === input.zernioAccountId || a.id === input.zernioAccountId);
  if (!acc) throw new Error("The key does not reach that Zernio account");
  if (acc.platform !== "instagram") throw new Error("That Zernio account is not an Instagram account");
  const username = str(acc.username) ?? str(acc.displayName) ?? input.zernioAccountId;
  const apiKey = deps.encrypt(input.apiKey);
  const row = await db.osViewInbox.upsert({
    where: { workspaceId_zernioAccountId: { workspaceId: input.workspaceId, zernioAccountId: input.zernioAccountId } },
    create: { workspaceId: input.workspaceId, label: input.label, apiKey, zernioAccountId: input.zernioAccountId, username },
    update: { label: input.label, apiKey, username },
    select: { id: true },
  });
  return { id: row.id, username };
}
