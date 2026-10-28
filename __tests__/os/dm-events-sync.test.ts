// DM events → DataOS, the sync half (lib/os/dataos/dm-events.ts): mapping to
// the contract's kinds, the cursor, the payload allowlist, off when unconfigured.
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  contactCode,
  DM_EVENT_KINDS,
  DM_EVENTS_BATCH,
  DM_EVENTS_LAG_MS,
  mapRunEvent,
  syncDmEvents,
  type CursorPos,
  type DmEventsBody,
  type DmEventsConfig,
  type DmEventsCursor,
  type DmEventsDb,
  type RunEventSrc,
  type SkipSrc,
} from "@/lib/os/dataos/dm-events";

const NOW = new Date("2026-10-28T12:00:00Z");
const SECRET = "s3cret";
const GRAPH = { version: 1, nodes: [{ id: "trigger", type: "trigger", position: { x: 0, y: 0 }, data: { kind: "comment", keywords: ["vault"] } }], edges: [] };

// What the rows really hold: the trigger keeps the comment's text, the person's
// name lives on the contact. None of it may leave.
const RUN = { id: "run1", contactId: "contact_1", trigger: { kind: "comment", postId: "trial1", originalPostId: "orig1", commentId: "cm1", text: "VAULT pls @sam.smith sam@example.com +447700900123", keyword: "vault" } };

let seq = 0;
const at = (minAgo: number) => new Date(NOW.getTime() - minAgo * 60_000);
const ev = (kind: string, over: Partial<RunEventSrc> = {}): RunEventSrc => ({
  id: `e${String(++seq).padStart(4, "0")}`,
  at: at(30),
  kind,
  port: null,
  nodeId: "n1",
  data: {},
  runId: "run1",
  workflowId: "wf1",
  versionId: "v1",
  ...over,
});

function fakeDb(o: { configs?: DmEventsConfig[]; events?: RunEventSrc[]; skips?: SkipSrc[] }) {
  const events = o.events ?? [];
  const skips = o.skips ?? [];
  const cursors: { cursor: DmEventsCursor; error: string | null }[] = [];
  const gt = (r: { at: Date; id: string }, c: CursorPos | null) => !c || r.at.getTime() > new Date(c.at).getTime() || (r.at.getTime() === new Date(c.at).getTime() && r.id > c.id);
  const page = <T extends { at: Date; id: string }>(rows: T[], c: CursorPos | null, until: Date, limit: number) =>
    rows.filter((r) => gt(r, c) && r.at <= until).sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id)).slice(0, limit);
  const db: DmEventsDb = {
    configs: vi.fn(async () => o.configs ?? []),
    runEvents: vi.fn(async (_w, c, until, limit) => page(events, c, until, limit)),
    skips: vi.fn(async (_w, c, until, limit) => page(skips, c, until, limit)),
    runs: vi.fn(async (ids) => [RUN].filter((r) => ids.includes(r.id))),
    versions: vi.fn(async (ids) => [{ id: "v1", workflowId: "wf1", graph: GRAPH, keywords: ["vault"] }].filter((v) => ids.includes(v.id))),
    workflows: vi.fn(async (ids) => [{ id: "wf1", name: "Script vault", currentVersionId: "v1" }].filter((w) => ids.includes(w.id))),
    saveCursor: vi.fn(async (_w, cursor, error) => {
      cursors.push({ cursor: structuredClone(cursor), error });
    }),
  };
  return { db, cursors };
}

function dataos(status = 200) {
  const bodies: DmEventsBody[] = [];
  const calls: { url: string; auth: string | null }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), auth: (init?.headers as Record<string, string>)?.Authorization ?? null });
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ accepted: 1, duplicates: 0 }), { status });
  });
  return { fetch: fn as unknown as typeof fetch, bodies, calls };
}

const cfg = (cursor: DmEventsCursor = {}): DmEventsConfig => ({ workspaceId: "ws1", baseUrl: "https://dataos.test/", ingestKey: "dk_live_1", contactSecret: SECRET, cursor });

describe("mapping", () => {
  const all = [
    ev("enter", { nodeId: "trigger" }),
    ev("enter", { nodeId: "opener" }),
    ev("leave", { nodeId: "opener", port: "button:send" }),
    ev("leave", { nodeId: "opener", port: "next" }),
    ev("released", { nodeId: "link", data: { slug: "script-vault", rule: "message" } }),
    ev("link_clicked", { nodeId: "link", data: { slug: "script-vault", link: "l1" } }),
    ev("replied", { nodeId: "ask", data: { saved: true, validate: "email" } }),
    ev("replied", { nodeId: "ask" }),
    ev("end", { nodeId: "end", data: { status: "completed", exit: "completed" } }),
    ev("end", { nodeId: "s", data: { status: "exited", exit: "quiet" } }),
    ev("failed", { nodeId: "s", data: { reason: "Zernio 500 for sam" } }),
    ev("sent"),
  ];

  it("each source event becomes its contract kind (or nothing)", () => {
    const out = all.map((e) => mapRunEvent(e, RUN, "trigger", SECRET));
    expect(out.map((e) => e && [e.kind, e.resource, e.detail])).toEqual([
      ["entered", null, {}],
      null,
      ["button_clicked", null, { button: "send" }],
      null,
      ["resource_sent", "script-vault", {}],
      ["link_clicked", "script-vault", {}],
      ["optin", null, {}],
      null,
      ["completed", null, { exit: "completed" }],
      ["exited", null, { exit: "quiet" }],
      ["exited", null, { exit: "failed" }],
      null,
    ]);
    const entered = out[0]!;
    expect(entered).toMatchObject({ id: all[0].id, workflow_id: "wf1", run_id: "run1", ig_media_id: "trial1", ig_original_media_id: "orig1" });
  });

  it("contact_code: first 16 hex of HMAC-SHA256(contactId, workspace secret), never the id", () => {
    const expected = createHmac("sha256", SECRET).update("contact_1").digest("hex").slice(0, 16);
    expect(contactCode("contact_1", SECRET)).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{16}$/);
    expect(contactCode("contact_1", "other")).not.toBe(expected);
    expect(contactCode(null, SECRET)).toBeNull();
    expect(mapRunEvent(all[0], RUN, "trigger", SECRET)!.contact_code).toBe(expected);
  });

  it("the original post is null when it is the same post", () => {
    const run = { ...RUN, trigger: { postId: "p1", originalPostId: "p1" } };
    expect(mapRunEvent(all[0], run, "trigger", SECRET)!.ig_original_media_id).toBeNull();
  });
});

describe("sync", () => {
  it("off when no workspace is configured: nothing read, nothing sent", async () => {
    const { db } = fakeDb({ configs: [] });
    const api = dataos();
    expect(await syncDmEvents({ db, fetch: api.fetch, now: () => NOW })).toEqual([]);
    expect(db.runEvents).not.toHaveBeenCalled();
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it("POSTs to <url>/api/dm-events with the bearer key, then saves the cursor at the last row", async () => {
    const events = [ev("enter", { nodeId: "trigger", at: at(40) }), ev("released", { nodeId: "link", at: at(30), data: { slug: "script-vault" } })];
    const skips: SkipSrc[] = [{ id: "os1", at: at(20), contactId: null, data: { workflowId: "wf1", postId: "trial1", originalPostId: null, reason: "owned_by_automation" } }];
    const { db, cursors } = fakeDb({ configs: [cfg()], events, skips });
    const api = dataos();
    const [r] = await syncDmEvents({ db, fetch: api.fetch, now: () => NOW });
    expect(r).toEqual({ workspaceId: "ws1", sent: 3, posts: 2, error: null });
    expect(api.calls.every((c) => c.url === "https://dataos.test/api/dm-events" && c.auth === "Bearer dk_live_1")).toBe(true);
    expect(api.bodies[0].workflows).toEqual([{ id: "wf1", name: "Script vault", keyword: "VAULT" }]);
    expect(api.bodies[0].events.map((e) => e.kind)).toEqual(["entered", "resource_sent"]);
    expect(api.bodies[1].events).toEqual([
      { id: "os1", at: at(20).toISOString(), kind: "skipped", workflow_id: "wf1", run_id: null, ig_media_id: "trial1", ig_original_media_id: null, contact_code: null, resource: null, detail: { reason: "owned_by_automation" } },
    ]);
    expect(cursors.at(-1)).toEqual({ cursor: { run: { at: events[1].at.toISOString(), id: events[1].id }, skip: { at: at(20).toISOString(), id: "os1" } }, error: null });
  });

  it("a non-2xx keeps the cursor where it was (the next tick resends: DataOS upserts by id)", async () => {
    const events = [ev("enter", { nodeId: "trigger" })];
    const start = { run: { at: at(60).toISOString(), id: "e0000" } };
    const { db, cursors } = fakeDb({ configs: [cfg(start)], events });
    const api = dataos(500);
    const [r] = await syncDmEvents({ db, fetch: api.fetch, now: () => NOW });
    expect(r.error).toMatch(/HTTP 500/);
    expect(cursors).toEqual([{ cursor: { run: start.run, skip: null }, error: r.error }]);
  });

  it("reads after the stored cursor and leaves rows younger than the lag for the next tick", async () => {
    const old = ev("enter", { nodeId: "trigger", at: at(90) });
    const fresh = ev("enter", { nodeId: "trigger", at: new Date(NOW.getTime() - DM_EVENTS_LAG_MS / 2) });
    const mid = ev("released", { at: at(30), data: { slug: "x" } });
    const { db } = fakeDb({ configs: [cfg({ run: { at: old.at.toISOString(), id: old.id } })], events: [old, mid, fresh] });
    const api = dataos();
    await syncDmEvents({ db, fetch: api.fetch, now: () => NOW });
    expect(api.bodies.flatMap((b) => b.events.map((e) => e.id))).toEqual([mid.id]);
  });

  it("≤ 500 events per POST; pages until drained", async () => {
    const events = Array.from({ length: DM_EVENTS_BATCH + 20 }, () => ev("released", { data: { slug: "x" } }));
    const { db } = fakeDb({ configs: [cfg()], events });
    const api = dataos();
    const [r] = await syncDmEvents({ db, fetch: api.fetch, now: () => NOW });
    expect(api.bodies.map((b) => b.events.length)).toEqual([DM_EVENTS_BATCH, 20]);
    expect(r.sent).toBe(DM_EVENTS_BATCH + 20);
  });

  it("the payload carries only contract fields: no names, handles, text, emails or phone numbers", async () => {
    const events = [
      ev("enter", { nodeId: "trigger" }),
      ev("leave", { port: "button:send" }),
      ev("released", { data: { slug: "script-vault", rule: "R1" } }),
      ev("link_clicked", { data: { slug: "script-vault", link: "l1" } }),
      ev("replied", { data: { saved: true, validate: "email", value: "sam@example.com" } }),
      ev("end", { data: { status: "exited", exit: "quiet" } }),
      ev("failed", { data: { reason: "Zernio said: user @sam.smith blocked" } }),
    ];
    const skips: SkipSrc[] = [{ id: "os1", at: at(20), contactId: "contact_1", data: { workflowId: "wf1", postId: "trial1", originalPostId: "orig1", reason: "rate_limit", text: "VAULT @sam.smith" } }];
    const { db } = fakeDb({ configs: [cfg()], events, skips });
    const api = dataos();
    await syncDmEvents({ db, fetch: api.fetch, now: () => NOW });

    const EVENT_KEYS = ["id", "at", "kind", "workflow_id", "run_id", "ig_media_id", "ig_original_media_id", "contact_code", "resource", "detail"].sort();
    for (const body of api.bodies) {
      expect(Object.keys(body).sort()).toEqual(["events", "workflows", "workspace"]);
      for (const w of body.workflows) expect(Object.keys(w).sort()).toEqual(["id", "keyword", "name"]);
      for (const e of body.events) {
        expect(Object.keys(e).sort()).toEqual(EVENT_KEYS);
        expect(DM_EVENT_KINDS).toContain(e.kind);
        for (const k of Object.keys(e.detail)) expect(["button", "reason", "exit"]).toContain(k);
        expect(e.contact_code === null || /^[0-9a-f]{16}$/.test(e.contact_code)).toBe(true);
      }
    }
    const wire = JSON.stringify(api.bodies);
    for (const leak of ["sam", "example.com", "+447700900123", "VAULT pls", "contact_1", "Zernio", "validate"]) expect(wire).not.toContain(leak);
    expect(api.bodies.flatMap((b) => b.events).length).toBe(events.length + 1);
  });
});
