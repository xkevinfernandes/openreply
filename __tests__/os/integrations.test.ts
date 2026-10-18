import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncContact, type SyncDeps } from "../../lib/os/integrations/engine";
import { createGhlSync, GHL_VERSION } from "../../lib/os/integrations/ghl";
import { payloadHash } from "../../lib/os/integrations/hash";
import { createKitSync } from "../../lib/os/integrations/kit";
import {
  buildPayload,
  defaultMapping,
  normalizeMapping,
  qualificationFromDrafts,
  type ContactSnapshot,
  type FieldMapping,
} from "../../lib/os/integrations/mapping";
import { SyncApiError, tagDiff, type SyncProvider } from "../../lib/os/integrations/provider";

type Call = { url: string; method: string; body: unknown; headers: Record<string, string> };

/** fetch stub: routes "METHOD path" to a response; records every call. */
function mockFetch(routes: Record<string, unknown | ((body: unknown) => unknown)>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body, headers: (init?.headers ?? {}) as Record<string, string> });
    const path = new URL(url).pathname + new URL(url).search;
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(" ");
      return m === method && (p.endsWith("*") ? path.startsWith(p.slice(0, -1)) : path === p);
    });
    if (!key) return new Response("not found", { status: 404 });
    const value = routes[key];
    const out = typeof value === "function" ? (value as (b: unknown) => unknown)(body) : value;
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out ?? {}), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const contact = (over: Partial<ContactSnapshot> = {}): ContactSnapshot => ({
  id: "c1",
  kind: "SALES",
  stage: "QUALIFIED",
  username: "maya.builds",
  fullName: "Maya Lopez",
  email: "Maya@Example.com",
  tags: ["qualified", "friday"],
  qualification: { their_goal: "10k/month", fit_score: "4" },
  ...over,
});

const mapping = (over: Partial<FieldMapping> = {}): FieldMapping => ({
  ...defaultMapping(),
  igHandle: "ig_handle",
  stage: "dm_stage",
  qualification: { their_goal: "goal" },
  ...over,
});

describe("mapping", () => {
  it("builds the payload from the mapping", () => {
    const p = buildPayload(contact(), mapping({ tagPrefix: "ig-" }));
    expect(p.email).toBe("maya@example.com");
    expect(p.firstName).toBe("Maya");
    expect(p.tags).toEqual(["ig-friday", "ig-qualified"]);
    expect(p.custom).toEqual({ ig_handle: "@maya.builds", dm_stage: "Qualified", goal: "10k/month" });
  });

  it("leaves out what is switched off", () => {
    const p = buildPayload(contact(), { ...mapping(), firstName: false, tags: false, email: false, igHandle: null });
    expect(p).toMatchObject({ email: null, firstName: null, tags: [] });
    expect(p.custom.ig_handle).toBeUndefined();
  });

  it("normalizes junk and keeps known keys only", () => {
    const m = normalizeMapping({ scope: "nope", tags: "yes", qualification: { their_goal: " goal ", bogus: "x" }, stageMap: { WON: "s1", NOPE: "s2" } });
    expect(m.scope).toBe("sales");
    expect(m.tags).toBe(true);
    expect(m.qualification).toEqual({ their_goal: "goal" });
    expect(m.stageMap).toEqual({ WON: "s1" });
  });

  it("reads J's latest qualification answers, newest draft first", () => {
    const q = qualificationFromDrafts([
      { qualification: { niche: "fitness coaching", fit_score: 0, is_owner: true }, invite: { their_challenge: "no leads" } },
      { qualification: { niche: "old answer", pain: "time" } },
      null,
    ]);
    expect(q).toEqual({ niche: "fitness coaching", is_owner: "yes", their_challenge: "no leads", pain: "time" });
  });

  it("hashes the same payload the same way", () => {
    const a = buildPayload(contact(), mapping());
    const b = buildPayload(contact({ tags: ["friday", "qualified"] }), mapping());
    expect(payloadHash("kit", a)).toBe(payloadHash("kit", b));
    expect(payloadHash("kit", a)).not.toBe(payloadHash("ghl", a));
    expect(payloadHash("kit", a)).not.toBe(payloadHash("kit", buildPayload(contact({ stage: "WON" }), mapping())));
  });

  it("diffs tags against the last push", () => {
    expect(tagDiff(["a", "b"], { externalId: null, pushedTags: ["x"] })).toEqual({ add: ["a", "b"], remove: [] });
    expect(tagDiff(["a", "b"], { externalId: "1", pushedTags: ["a", "x"] })).toEqual({ add: ["b"], remove: ["x"] });
  });
});

describe("Kit", () => {
  it("upserts the subscriber with fields, creates and applies tags", async () => {
    const calls = mockFetch({
      "POST /v4/subscribers": { subscriber: { id: 77 } },
      "GET /v4/tags*": { tags: [{ id: 1, name: "qualified" }] },
      "POST /v4/tags": { tag: { id: 2, name: "friday" } },
      "POST /v4/tags/1/subscribers": {},
      "POST /v4/tags/2/subscribers": {},
    });
    const kit = createKitSync("kit_key_123");
    const result = await kit.push(buildPayload(contact(), mapping()), { externalId: null, pushedTags: [] });
    expect(result).toEqual({ externalId: "77", pushedTags: ["friday", "qualified"] });
    expect(calls[0].headers["X-Kit-Api-Key"]).toBe("kit_key_123");
    expect(calls[0].body).toEqual({
      email_address: "maya@example.com",
      first_name: "Maya",
      fields: { ig_handle: "@maya.builds", dm_stage: "Qualified", goal: "10k/month" },
    });
    expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/v4/tags"))?.body).toEqual({ name: "friday" });
    expect(calls.filter((c) => /\/tags\/\d+\/subscribers$/.test(c.url)).map((c) => c.body)).toEqual([
      { email_address: "maya@example.com" },
      { email_address: "maya@example.com" },
    ]);
  });

  it("untags what was removed and skips tag calls when nothing changed", async () => {
    let calls = mockFetch({
      "POST /v4/subscribers": { subscriber: { id: 77 } },
      "GET /v4/tags*": { tags: [{ id: 1, name: "qualified" }, { id: 2, name: "friday" }] },
      "DELETE /v4/tags/2/subscribers/77": new Response(null, { status: 204 }),
    });
    const kit = createKitSync("kit_key_123");
    await kit.push(buildPayload(contact({ tags: ["qualified"] }), mapping()), { externalId: "77", pushedTags: ["friday", "qualified"] });
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(["POST /v4/subscribers", "GET /v4/tags", "DELETE /v4/tags/2/subscribers/77"]);

    calls = mockFetch({ "POST /v4/subscribers": { subscriber: { id: 77 } } });
    await kit.push(buildPayload(contact({ tags: ["qualified"] }), mapping()), { externalId: "77", pushedTags: ["qualified"] });
    expect(calls).toHaveLength(1);
  });

  it("lists custom fields by key and maps HTTP errors", async () => {
    mockFetch({ "GET /v4/custom_fields*": { custom_fields: [{ id: 1, key: "ig_handle", label: "IG handle" }] } });
    expect((await createKitSync("k_123456789").listFields()).customFields).toEqual([{ ref: "ig_handle", label: "IG handle" }]);
    mockFetch({ "GET /v4/account": new Response("{}", { status: 401 }) });
    await expect(createKitSync("k_123456789").verify()).rejects.toMatchObject({ provider: "kit", status: 401 });
  });
});

describe("GoHighLevel", () => {
  const creds = { token: "pit-abc123456", locationId: "loc123" };
  const ghlMapping = () =>
    mapping({ igHandle: "fieldIg", stage: "contact.dm_stage", pipelineId: "pipe1", stageMap: { QUALIFIED: "stQual" } });

  it("upserts a new contact, adds tags and moves the opportunity", async () => {
    const calls = mockFetch({
      "POST /contacts/upsert": { new: true, contact: { id: "gc1" } },
      "POST /contacts/gc1/tags": { tags: [] },
      "POST /opportunities/upsert": { new: true },
    });
    const result = await createGhlSync(creds).push(buildPayload(contact(), ghlMapping()), { externalId: null, pushedTags: [] });
    expect(result).toEqual({ externalId: "gc1", pushedTags: ["friday", "qualified"] });
    const [upsert, tags, opp] = calls;
    expect(upsert.headers.Authorization).toBe("Bearer pit-abc123456");
    expect(upsert.headers.Version).toBe(GHL_VERSION);
    expect(upsert.body).toEqual({
      locationId: "loc123",
      source: "Instagram DM",
      name: "Maya Lopez",
      email: "maya@example.com",
      firstName: "Maya",
      customFields: [
        { id: "fieldIg", field_value: "@maya.builds" },
        { key: "contact.dm_stage", field_value: "Qualified" },
        { id: "goal", field_value: "10k/month" },
      ],
    });
    expect(tags.body).toEqual({ tags: ["friday", "qualified"] });
    expect(opp.body).toEqual({ locationId: "loc123", pipelineId: "pipe1", pipelineStageId: "stQual", contactId: "gc1", name: "Maya Lopez", status: "open" });
  });

  it("updates a known contact in place and removes dropped tags", async () => {
    const calls = mockFetch({
      "PUT /contacts/gc1": { contact: { id: "gc1" } },
      "DELETE /contacts/gc1/tags": { tags: [] },
    });
    await createGhlSync(creds).push(buildPayload(contact({ tags: ["qualified"], stage: "NEW" }), ghlMapping()), {
      externalId: "gc1",
      pushedTags: ["friday", "qualified"],
    });
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(["PUT /contacts/gc1", "DELETE /contacts/gc1/tags"]);
    expect(calls[0].body).not.toHaveProperty("locationId");
    expect(calls[1].body).toEqual({ tags: ["friday"] });
  });

  it("creates the contact again when it was deleted in GoHighLevel", async () => {
    const calls = mockFetch({
      "PUT /contacts/gone": new Response("{}", { status: 404 }),
      "POST /contacts/upsert": { contact: { id: "gc2" } },
      "POST /contacts/gc2/tags": {},
    });
    const result = await createGhlSync(creds).push(buildPayload(contact({ stage: "NEW" }), ghlMapping()), { externalId: "gone", pushedTags: ["friday", "qualified"] });
    expect(result.externalId).toBe("gc2");
    // A fresh contact gets every tag, not just the diff.
    expect(calls.at(-1)?.body).toEqual({ tags: ["friday", "qualified"] });
  });

  it("verifies against the location's custom fields and lists pipelines", async () => {
    const calls = mockFetch({
      "GET /locations/loc123/customFields": { customFields: [{ id: "f1", name: "Instagram", model: "contact" }, { id: "f2", name: "Deal size", model: "opportunity" }] },
      "GET /opportunities/pipelines?locationId=loc123": { pipelines: [{ id: "p1", name: "Sales", stages: [{ id: "s1", name: "New" }] }] },
    });
    const ghl = createGhlSync(creds);
    await ghl.verify();
    expect(calls[0].url).toBe("https://services.leadconnectorhq.com/locations/loc123/customFields");
    expect(await ghl.listFields()).toEqual({
      customFields: [{ ref: "f1", label: "Instagram" }],
      pipelines: [{ id: "p1", name: "Sales", stages: [{ id: "s1", name: "New" }] }],
    });
  });
});

describe("syncContact", () => {
  let pushes: number;
  let log: { externalId: string | null; pushedTags: string[]; lastHash: string | null; lastError: string | null } | null;
  let failures: string[];

  function deps(over: Partial<SyncDeps> = {}, client: Partial<SyncProvider> = {}, snap = contact(), m = mapping()): SyncDeps {
    const provider: SyncProvider = {
      id: "ghl",
      requiresEmail: false,
      verify: async () => {},
      listFields: async () => ({ customFields: [], pipelines: [] }),
      push: async (p) => {
        pushes++;
        return { externalId: "gc1", pushedTags: p.tags };
      },
      ...client,
    };
    return {
      loadProvider: async () => ({ provider: "ghl", client: provider, mapping: m, enabled: true }),
      contactSnapshot: async () => snap,
      getSyncLog: async () => log,
      recordSuccess: async (_key, data) => {
        log = { externalId: data.externalId, pushedTags: data.pushedTags, lastHash: data.hash, lastError: null };
      },
      recordFailure: async (_key, error) => {
        failures.push(error);
        log = { ...(log ?? { externalId: null, pushedTags: [], lastHash: null }), lastError: error };
      },
      ...over,
    };
  }

  beforeEach(() => {
    pushes = 0;
    log = null;
    failures = [];
  });

  const job = { workspaceId: "w1", contactId: "c1", provider: "ghl" as const, event: "stage_changed" as const };

  it("pushes once; a repeat event with nothing new is a no-op", async () => {
    const d = deps();
    expect(await syncContact(job, d)).toEqual({ status: "synced", externalId: "gc1" });
    expect(await syncContact({ ...job, event: "tags_changed" }, d)).toEqual({ status: "unchanged" });
    expect(pushes).toBe(1);
  });

  it("keeps personal contacts out unless the mapping says everyone", async () => {
    expect(await syncContact(job, deps({}, {}, contact({ kind: "PERSONAL" })))).toEqual({ status: "skipped", reason: "not a sales contact" });
    expect((await syncContact(job, deps({}, {}, contact({ kind: "PERSONAL" }), mapping({ scope: "all" })))).status).toBe("synced");
  });

  it("waits for an email when the provider needs one", async () => {
    expect(await syncContact(job, deps({}, { requiresEmail: true }, contact({ email: null })))).toEqual({ status: "skipped", reason: "waits for an email" });
    expect(pushes).toBe(0);
  });

  it("records a failure, rethrows for the retry, and pushes again next time", async () => {
    const failing = deps({}, { push: async () => Promise.reject(new SyncApiError("ghl", 401)) });
    await expect(syncContact(job, failing)).rejects.toBeInstanceOf(SyncApiError);
    expect(failures[0]).toMatch(/rejected the key/);
    expect(await syncContact(job, deps())).toMatchObject({ status: "synced" });
  });

  it("skips when the provider is not connected or paused", async () => {
    expect(await syncContact(job, deps({ loadProvider: async () => null }))).toEqual({ status: "skipped", reason: "not connected" });
  });
});
