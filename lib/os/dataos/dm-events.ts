// DM events → DataOS (contract 2026-10-28): every 10 minutes the worker sends
// each configured workspace's workflow events newer than a stored cursor to
// `<DataOS>/api/dm-events`, ≤ 500 per POST, with the workspace's ingest key.
//
// Nothing is stored for this: the events are the rows the engine already
// writes (WorkflowRunEvent; skips are OsEvent "workflow_skipped") and they are
// mapped here. Only contract fields leave DM OS: no names, handles, message
// text, emails or phone numbers. The person is a contact_code (HMAC of the
// contact id with a per-workspace secret), never the id itself.
//
// The cursor advances only after a 2xx, and DataOS upserts on event id, so a
// retry after a failure (or two workers racing) only resends.

import { createHmac } from "node:crypto";
import { triggerNode } from "@/lib/os/workflows/triggers";
import type { WorkflowGraph } from "@/lib/os/workflows/graph";

export const DM_EVENTS_PROVIDER = "dataos_events";
export const DM_EVENTS_INTERVAL_MS = 10 * 60_000;
export const DM_EVENTS_BATCH = 500;
/** Rows younger than this wait for the next tick (a write still committing can't slip behind the cursor). */
export const DM_EVENTS_LAG_MS = 2 * 60_000;
/** Pages per stream per tick: a backlog drains over a few ticks, never in one long burst. */
export const DM_EVENTS_MAX_PAGES = 20;

export const DM_EVENT_KINDS = ["entered", "button_clicked", "link_clicked", "resource_sent", "optin", "completed", "exited", "skipped"] as const;
export type DmEventKind = (typeof DM_EVENT_KINDS)[number];

/** The wire event: exactly the contract's fields. */
export interface DmEvent {
  id: string;
  at: string;
  kind: DmEventKind;
  workflow_id: string;
  run_id: string | null;
  ig_media_id: string | null;
  ig_original_media_id: string | null;
  contact_code: string | null;
  resource: string | null;
  detail: { button?: string; reason?: string; exit?: string };
}

export interface DmWorkflow {
  id: string;
  name: string;
  keyword: string | null;
}

export interface DmEventsBody {
  workspace: string;
  workflows: DmWorkflow[];
  events: DmEvent[];
}

// ---------------------------------------------------------------- sources
export interface RunEventSrc {
  id: string;
  at: Date;
  kind: string;
  port: string | null;
  nodeId: string;
  data: unknown;
  runId: string;
  workflowId: string;
  versionId: string;
}

export interface RunSrc {
  id: string;
  contactId: string | null;
  /** {postId, originalPostId, …}: only the two post ids are read. */
  trigger: unknown;
}

export interface SkipSrc {
  id: string;
  at: Date;
  contactId: string | null;
  /** {workflowId, postId, originalPostId, reason}. */
  data: unknown;
}

export interface VersionSrc {
  id: string;
  workflowId: string;
  graph: unknown;
  keywords: string[];
}

export interface CursorPos {
  at: string;
  id: string;
}

/** One position per source table. */
export interface DmEventsCursor {
  run?: CursorPos | null;
  skip?: CursorPos | null;
}

export interface DmEventsConfig {
  workspaceId: string;
  baseUrl: string;
  ingestKey: string;
  contactSecret: string;
  cursor: DmEventsCursor;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** First 16 hex of HMAC-SHA256(contactId, workspace secret). Null without a contact. */
export function contactCode(contactId: string | null | undefined, secret: string): string | null {
  if (!contactId) return null;
  return createHmac("sha256", secret).update(contactId).digest("hex").slice(0, 16);
}

function posts(trigger: unknown): { media: string | null; original: string | null } {
  const t = obj(trigger);
  const media = str(t.postId);
  const original = str(t.originalPostId);
  return { media, original: original && original !== media ? original : null };
}

/** The trigger node of a version (its `enter` is the run's entry). */
export function triggerNodeId(graph: unknown): string | null {
  const g = obj(graph);
  if (!Array.isArray(g.nodes)) return null;
  return triggerNode(g as unknown as WorkflowGraph)?.id ?? null;
}

/** A WorkflowRunEvent as a contract event, or null when DataOS doesn't take that kind. */
export function mapRunEvent(e: RunEventSrc, run: RunSrc | undefined, triggerId: string | null, secret: string): DmEvent | null {
  const d = obj(e.data);
  let kind: DmEventKind | null = null;
  let resource: string | null = null;
  const detail: DmEvent["detail"] = {};
  switch (e.kind) {
    case "enter":
      if (triggerId && e.nodeId === triggerId) kind = "entered";
      break;
    case "leave":
      if (e.port?.startsWith("button:")) {
        kind = "button_clicked";
        detail.button = e.port.slice("button:".length);
      }
      break;
    case "released":
      kind = "resource_sent";
      resource = str(d.slug);
      break;
    case "replied":
      // The fact a field was captured, never its value.
      if (d.saved === true) kind = "optin";
      break;
    case "link_clicked":
      kind = "link_clicked";
      resource = str(d.slug);
      break;
    case "end": {
      const exit = str(d.exit);
      kind = d.status === "completed" ? "completed" : "exited";
      if (exit) detail.exit = exit;
      break;
    }
    case "failed":
      kind = "exited";
      detail.exit = "failed";
      break;
  }
  if (!kind) return null;
  const p = posts(run?.trigger);
  return {
    id: e.id,
    at: e.at.toISOString(),
    kind,
    workflow_id: e.workflowId,
    run_id: e.runId,
    ig_media_id: p.media,
    ig_original_media_id: p.original,
    contact_code: contactCode(run?.contactId, secret),
    resource,
    detail,
  };
}

/** An OsEvent "workflow_skipped" as a contract `skipped` (no run). */
export function mapSkip(e: SkipSrc, secret: string): DmEvent | null {
  const d = obj(e.data);
  const workflowId = str(d.workflowId);
  if (!workflowId) return null;
  const media = str(d.postId);
  const original = str(d.originalPostId);
  const reason = str(d.reason);
  return {
    id: e.id,
    at: e.at.toISOString(),
    kind: "skipped",
    workflow_id: workflowId,
    run_id: null,
    ig_media_id: media,
    ig_original_media_id: original && original !== media ? original : null,
    contact_code: contactCode(e.contactId, secret),
    resource: null,
    detail: reason ? { reason } : {},
  };
}

// ---------------------------------------------------------------- the job
export interface DmEventsDb {
  /** Enabled, fully configured workspaces (secrets decrypted). */
  configs(): Promise<DmEventsConfig[]>;
  /** Mappable WorkflowRunEvents after the cursor, at ≤ until, oldest first. */
  runEvents(workspaceId: string, after: CursorPos | null, until: Date, limit: number): Promise<RunEventSrc[]>;
  /** OsEvent "workflow_skipped" after the cursor, at ≤ until, oldest first. */
  skips(workspaceId: string, after: CursorPos | null, until: Date, limit: number): Promise<SkipSrc[]>;
  runs(ids: string[]): Promise<RunSrc[]>;
  versions(ids: string[]): Promise<VersionSrc[]>;
  workflows(ids: string[]): Promise<{ id: string; name: string; currentVersionId: string | null }[]>;
  saveCursor(workspaceId: string, cursor: DmEventsCursor, error: string | null): Promise<void>;
}

export interface DmEventsDeps {
  db: DmEventsDb;
  fetch?: typeof fetch;
  now?: () => Date;
}

export interface DmEventsResult {
  workspaceId: string;
  sent: number;
  posts: number;
  error: string | null;
}

const posOf = (r: { at: Date; id: string }): CursorPos => ({ at: r.at.toISOString(), id: r.id });

async function workflowsOf(db: DmEventsDb, ids: string[]): Promise<DmWorkflow[]> {
  if (!ids.length) return [];
  const wfs = await db.workflows(ids);
  const versions = await db.versions(wfs.map((w) => w.currentVersionId).filter((v): v is string => Boolean(v)));
  return wfs.map((w) => {
    const k = versions.find((v) => v.id === w.currentVersionId)?.keywords[0];
    return { id: w.id, name: w.name, keyword: k ? k.toUpperCase() : null };
  });
}

export async function postDmEvents(cfg: Pick<DmEventsConfig, "baseUrl" | "ingestKey">, body: DmEventsBody, send: typeof fetch = fetch): Promise<void> {
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/api/dm-events`;
  const res = await send(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.ingestKey}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`DataOS dm-events HTTP ${res.status}`);
}

/** One workspace: both streams, page by page, the cursor saved after each accepted POST. */
export async function syncWorkspace(cfg: DmEventsConfig, deps: DmEventsDeps): Promise<DmEventsResult> {
  const { db } = deps;
  const until = new Date((deps.now?.() ?? new Date()).getTime() - DM_EVENTS_LAG_MS);
  const cursor: DmEventsCursor = { run: cfg.cursor.run ?? null, skip: cfg.cursor.skip ?? null };
  const out: DmEventsResult = { workspaceId: cfg.workspaceId, sent: 0, posts: 0, error: null };

  const flush = async (events: DmEvent[]) => {
    if (!events.length) return;
    const body: DmEventsBody = { workspace: cfg.workspaceId, workflows: await workflowsOf(db, [...new Set(events.map((e) => e.workflow_id))]), events };
    await postDmEvents(cfg, body, deps.fetch);
    out.sent += events.length;
    out.posts += 1;
  };

  try {
    for (let page = 0; page < DM_EVENTS_MAX_PAGES; page++) {
      const rows = await db.runEvents(cfg.workspaceId, cursor.run ?? null, until, DM_EVENTS_BATCH);
      if (!rows.length) break;
      const runs = new Map((await db.runs([...new Set(rows.map((r) => r.runId))])).map((r) => [r.id, r]));
      const versions = await db.versions([...new Set(rows.filter((r) => r.kind === "enter").map((r) => r.versionId))]);
      const trig = new Map(versions.map((v) => [v.id, triggerNodeId(v.graph)]));
      await flush(rows.map((r) => mapRunEvent(r, runs.get(r.runId), trig.get(r.versionId) ?? null, cfg.contactSecret)).filter((e): e is DmEvent => e !== null));
      cursor.run = posOf(rows[rows.length - 1]);
      await db.saveCursor(cfg.workspaceId, cursor, null);
      if (rows.length < DM_EVENTS_BATCH) break;
    }
    for (let page = 0; page < DM_EVENTS_MAX_PAGES; page++) {
      const rows = await db.skips(cfg.workspaceId, cursor.skip ?? null, until, DM_EVENTS_BATCH);
      if (!rows.length) break;
      await flush(rows.map((r) => mapSkip(r, cfg.contactSecret)).filter((e): e is DmEvent => e !== null));
      cursor.skip = posOf(rows[rows.length - 1]);
      await db.saveCursor(cfg.workspaceId, cursor, null);
      if (rows.length < DM_EVENTS_BATCH) break;
    }
  } catch (err) {
    // The cursor stays where the last accepted POST left it: the next tick resends from there.
    out.error = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    await db.saveCursor(cfg.workspaceId, cursor, out.error).catch(() => {});
  }
  return out;
}

/** Every configured workspace. Off (nothing read, nothing sent) when none is configured. */
export async function syncDmEvents(deps: DmEventsDeps): Promise<DmEventsResult[]> {
  const configs = await deps.db.configs();
  const out: DmEventsResult[] = [];
  for (const cfg of configs) out.push(await syncWorkspace(cfg, deps));
  return out;
}
