// Field sync (spec §5): the write API, the merge rules, the batched push and
// every edge case, against in-memory Kit / GoHighLevel (fixtures/mock-crm.ts).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detailsFields } from "../../lib/os/contact-panel/details";
import { coerceFieldValue, decideWrite, historyTitle, isPushable, parseNumberish } from "../../lib/os/fields/merge";
import type { CustomFieldType } from "../../lib/os/fields/types";
import { addTag, markStopped, removeTag, writeField, type TagDeps, type WriteDeps } from "../../lib/os/fields/write";
import { syncContact, type SyncDeps } from "../../lib/os/integrations/engine";
import { createGhlSync } from "../../lib/os/integrations/ghl";
import { createKitSync } from "../../lib/os/integrations/kit";
import { defaultMapping, type ContactSnapshot, type FieldMapping, type SyncProviderId } from "../../lib/os/integrations/mapping";
import { fillOnly } from "../../lib/os/integrations/provider";
import { flushJobOptions, markDirty, QUIET_MS, syncDisabled } from "../../lib/os/integrations/queue";
import type { SyncLogRow, SyncStateRow } from "../../lib/os/integrations/store";
import { MockGhl, MockKit, stubCrms } from "./fixtures/mock-crm";
import { vi } from "vitest";

type Field = { id: string; key: string; type: CustomFieldType; options: string[]; ghlField: string | null; kitField: string | null };

const FIELDS: Field[] = [
  { id: "f-first", key: "first_name", type: "TEXT", options: [], ghlField: null, kitField: null },
  { id: "f-email", key: "email", type: "EMAIL", options: [], ghlField: null, kitField: null },
  { id: "f-phone", key: "phone", type: "TEXT", options: [], ghlField: null, kitField: null },
  { id: "f-niche", key: "niche", type: "TEXT", options: [], ghlField: "fNiche", kitField: "niche" },
  { id: "f-rev", key: "monthly_revenue", type: "NUMBER", options: [], ghlField: "fRev", kitField: "revenue" },
  { id: "f-goal", key: "their_goal", type: "TEXT", options: [], ghlField: "contact.dm_stage", kitField: "goal" },
];

/** One contact's world: DM OS rows, sync rows, which CRMs are connected. */
class World {
  contact: Omit<ContactSnapshot, "qualification" | "fields"> = {
    id: "c1",
    kind: "SALES",
    stage: "IN_CONVERSATION",
    username: "maya.builds",
    fullName: "Maya Lopez",
    email: null,
    tags: [],
  };
  exists = true;
  fields = FIELDS.map((f) => ({ ...f }));
  values = new Map<string, { value: string; source: string; at: Date }>();
  history: { fieldId: string; value: string | null; raw: string | null; source: string; applied: boolean; reason: string | null; at: Date }[] = [];
  log = new Map<SyncProviderId, SyncLogRow & { lastSyncedAt: Date | null; lastErrorAt: Date | null }>();
  state = new Map<SyncProviderId, SyncStateRow>();
  connected = new Set<SyncProviderId>();
  mapping: FieldMapping = { ...defaultMapping() };
  dirty: { contactId: string; event: string }[] = [];

  writeDeps: WriteDeps = {
    field: async (_w, key) => this.fields.find((f) => f.key === key) ?? null,
    contactExists: async () => this.exists,
    current: async (_c, fieldId) => this.values.get(fieldId) ?? null,
    save: async ({ fieldId, value, source, guard, at }) => {
      const prev = this.values.get(fieldId);
      if (guard && prev && (prev.source === "user" || prev.source === "kevin")) return false;
      if (value == null) this.values.delete(fieldId);
      else this.values.set(fieldId, { value, source, at });
      return true;
    },
    history: async (row) => void this.history.push(row),
    setEmail: async (_w, _c, email) => void (this.contact.email = email),
    markDirty: async (e) => void this.dirty.push({ contactId: e.contactId, event: e.event }),
  };

  tagDeps: TagDeps = {
    tags: async () => (this.exists ? this.contact.tags : null),
    setTags: async (_w, _c, tags) => void (this.contact.tags = tags),
    pendingRemoval: async (_w, _c, tag, remove) => {
      for (const p of ["kit", "ghl"] as const) {
        const s = this.state.get(p) ?? { pushedFields: {}, pushedEmail: null, removeTags: [] };
        s.removeTags = s.removeTags.filter((t) => t !== tag);
        if (remove) s.removeTags.push(tag);
        this.state.set(p, s);
      }
    },
    markDirty: async (e) => void this.dirty.push({ contactId: e.contactId, event: e.event }),
  };

  syncDeps: SyncDeps = {
    loadProvider: async (_w, provider) =>
      this.connected.has(provider)
        ? { provider, client: provider === "kit" ? createKitSync("kit_test_key") : createGhlSync({ token: "pit-test", locationId: "loc1" }), mapping: this.mapping, enabled: true }
        : null,
    contactSnapshot: async () =>
      this.exists
        ? {
            ...this.contact,
            tags: [...this.contact.tags],
            qualification: {},
            fields: [...this.values].map(([fieldId, v]) => {
              const f = this.fields.find((x) => x.id === fieldId)!;
              return { key: f.key, value: v.value, ghlField: f.ghlField, kitField: f.kitField, pushable: isPushable(f, v.value) };
            }),
          }
        : null,
    getSyncLog: async (_c, p) => this.log.get(p) ?? null,
    getSyncState: async (_c, p) => this.state.get(p) ?? null,
    recordSuccess: async (key, data) => {
      this.log.set(key.provider, { externalId: data.externalId, pushedTags: data.pushedTags, lastHash: data.hash, lastError: null, lastSyncedAt: new Date(), lastErrorAt: null });
      const done = new Set(data.removedTags ?? []);
      const cur = this.state.get(key.provider);
      this.state.set(key.provider, { pushedFields: data.pushedFields ?? {}, pushedEmail: data.pushedEmail ?? null, removeTags: (cur?.removeTags ?? []).filter((t) => !done.has(t)) });
    },
    recordFailure: async (key, error) => {
      const cur = this.log.get(key.provider) ?? { externalId: null, pushedTags: [], lastHash: null, lastError: null, lastSyncedAt: null, lastErrorAt: null };
      this.log.set(key.provider, { ...cur, lastError: error, lastErrorAt: new Date() });
    },
  };

  write(key: string, value: unknown, source: "system" | "step" | "j" | "kevin" | "booking" = "j", at?: Date) {
    return writeField({ workspaceId: "w1", contactId: "c1", key, value, source, ref: `${source}-ref`, at }, this.writeDeps);
  }
  value(key: string) {
    return this.values.get(this.fields.find((f) => f.key === key)!.id)?.value ?? null;
  }
  /** The 30s-quiet flush: one push per connected provider. */
  async flush() {
    const out: Record<string, unknown> = {};
    for (const provider of ["kit", "ghl"] as const) {
      out[provider] = await syncContact({ workspaceId: "w1", contactId: "c1", provider, event: "manual" }, this.syncDeps).catch((e) => ({ error: String(e) }));
    }
    this.dirty = [];
    return out as Record<SyncProviderId, { status: string; reason?: string; externalId?: string | null; error?: string }>;
  }
}

let w: World;
let crm: ReturnType<typeof stubCrms>;

beforeEach(() => {
  w = new World();
  crm = stubCrms(new MockKit(), new MockGhl());
});
afterEach(() => vi.unstubAllGlobals());

describe("typed values", () => {
  it("parses how people say numbers, and refuses to guess", () => {
    expect(parseNumberish("about 5k a month")).toBe(5000);
    expect(parseNumberish("$10,000/mo")).toBe(10000);
    expect(parseNumberish("1.5m")).toBe(1500000);
    expect(parseNumberish("around 40 grand")).toBe(40000);
    expect(parseNumberish("4-5k")).toBeNull();
    expect(parseNumberish("between 3 and 5k")).toBeNull();
    expect(parseNumberish("a lot")).toBeNull();
  });

  it("stores a parsed number with what was said; an unparseable one as said, not pushed", () => {
    const num = { type: "NUMBER" as const, options: [] };
    expect(coerceFieldValue(num, "about 5k a month")).toEqual({ value: "5000", raw: "about 5k a month", pushable: true });
    expect(coerceFieldValue(num, "a lot")).toEqual({ value: "a lot", raw: null, pushable: false });
    expect(coerceFieldValue(num, "a lot", { strict: true })).toEqual({ error: "That isn't a number." });
    expect(isPushable(num, "5000")).toBe(true);
    expect(isPushable(num, "a lot")).toBe(false);
  });
});

describe("merge rules", () => {
  const at = (s: number) => new Date(Date.UTC(2026, 9, 19, 12, 0, s));

  it("Kevin's value is locked against every other writer", async () => {
    await w.write("niche", "Coach", "kevin");
    for (const source of ["j", "step", "system", "booking"] as const) {
      expect(await w.write("niche", "Creator", source)).toMatchObject({ applied: false, reason: "locked" });
    }
    expect(w.value("niche")).toBe("Coach");
    expect(w.history.filter((h) => !h.applied).map((h) => h.reason)).toEqual(["locked", "locked", "locked", "locked"]);
    // Kevin himself can change it.
    expect(await w.write("niche", "Creator", "kevin")).toMatchObject({ applied: true });
  });

  it("the newest non-empty value wins; an older write loses but is kept in the history", async () => {
    await w.write("their_goal", "10k a month", "step", at(10));
    expect(await w.write("their_goal", "quit the job", "j", at(20))).toMatchObject({ applied: true });
    expect(await w.write("their_goal", "late arrival", "step", at(15))).toMatchObject({ applied: false, reason: "stale" });
    expect(w.value("their_goal")).toBe("quit the job");
    expect(w.history.map((h) => [h.value, h.applied])).toEqual([
      ["10k a month", true],
      ["quit the job", true],
      ["late arrival", false],
    ]);
  });

  it("two workflows writing the same field: newest wins, both in the history", async () => {
    await w.write("niche", "Coach", "step");
    await w.write("niche", "Agency", "step");
    expect(w.value("niche")).toBe("Agency");
    expect(w.history.map((h) => h.value)).toEqual(["Coach", "Agency"]);
  });

  it("an empty value never wipes a filled one (only Kevin can clear)", async () => {
    await w.write("niche", "Coach", "j");
    expect(await w.write("niche", "", "j")).toMatchObject({ applied: false, reason: "empty" });
    expect(await w.write("niche", null, "step")).toMatchObject({ applied: false, reason: "empty" });
    expect(w.value("niche")).toBe("Coach");
    expect(await w.write("niche", null, "kevin")).toMatchObject({ applied: true, value: null });
    expect(w.value("niche")).toBeNull();
  });

  it("decideWrite on its own", () => {
    const prev = { value: "a", source: "j", at: at(5) };
    expect(decideWrite(prev, { value: "a", source: "j", at: at(6) })).toEqual({ apply: false, reason: "same" });
    expect(decideWrite(null, { value: "a", source: "j", at: at(6) })).toEqual({ apply: true });
    expect(decideWrite({ ...prev, source: "user" }, { value: "b", source: "j", at: at(6) })).toEqual({ apply: false, reason: "locked" });
  });

  it("an email that wins becomes the contact's email; a bad one is stored as said but isn't the email", async () => {
    await w.write("email", "Maya@Example.com", "step");
    expect(w.contact.email).toBe("maya@example.com");
    await w.write("email", "not an email", "j");
    expect(w.value("email")).toBe("not an email");
    expect(w.contact.email).toBe("maya@example.com");
  });

  it("history on hover reads like 'J · 19 Oct · 5000 from …'", () => {
    const t = historyTitle([
      { value: "5000", raw: "about 5k a month", source: "j", at: "2026-10-19T12:00:00Z", applied: true, reason: null },
      { value: "9000", raw: null, source: "step", at: "2026-10-18T12:00:00Z", applied: false, reason: "locked" },
    ]);
    expect(t).toBe("J · 19 Oct · 5000 from 'about 5k a month'\nWorkflow · 18 Oct · 9000 (kept yours)");
  });
});

describe("batched push", () => {
  it("every write marks the contact dirty; the flush job is one per contact after 30s of quiet", async () => {
    for (const [k, v] of [["niche", "Coach"], ["their_goal", "10k"], ["monthly_revenue", "5k"], ["first_name", "Maya"], ["phone", "+15550001"]]) await w.write(k, v);
    expect(w.dirty).toHaveLength(5);
    expect(new Set(w.dirty.map((d) => d.contactId))).toEqual(new Set(["c1"]));
    const opts = flushJobOptions("c1");
    expect(QUIET_MS).toBe(30_000);
    expect(opts).toMatchObject({ delay: 30_000, deduplication: { id: "flush_c1", ttl: 30_000, extend: true, replace: true } });
    expect(flushJobOptions("c2").deduplication.id).not.toBe(opts.deduplication.id);

    w.connected.add("ghl");
    crm.reset();
    await w.flush();
    // Five answers, one create call (plus the duplicate lookup by phone).
    expect(crm.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`)).toEqual(["POST /contacts/"]);
  });

  it("tests and the sandbox never sync", async () => {
    expect(syncDisabled()).toBe(true);
    await markDirty({ workspaceId: "w1", contactId: "c1", event: "manual" });
    const r = await writeField({ workspaceId: "w1", contactId: "c1", key: "niche", value: "Coach", source: "j", sandbox: true }, w.writeDeps);
    expect(r).toMatchObject({ applied: true, value: "Coach" });
    expect(w.values.size).toBe(0);
    expect(w.dirty).toEqual([]);
    expect(await addTag({ workspaceId: "w1", contactId: "c1", tag: "hot", source: "j", sandbox: true }, w.tagDeps)).toEqual({ changed: true });
    expect(w.contact.tags).toEqual([]);
    expect(crm.calls).toEqual([]);
  });
});

describe("Kit", () => {
  beforeEach(() => {
    w.connected.add("kit");
    w.mapping = { ...defaultMapping(), scope: "all" };
  });

  it("waits for an email, then pushes everything collected at once (fields + tags)", async () => {
    await w.write("niche", "Coach");
    await w.write("monthly_revenue", "about 5k a month");
    await addTag({ workspaceId: "w1", contactId: "c1", tag: "lead-magnet", source: "step" }, w.tagDeps);
    expect((await w.flush()).kit).toEqual({ status: "skipped", reason: "waits for an email" });
    expect(crm.calls).toEqual([]);

    await w.write("email", "maya@example.com", "step");
    await w.flush();
    const sub = crm.kit.byEmail("maya@example.com")!;
    expect(sub.fields).toEqual({ niche: "Coach", revenue: "5000" });
    expect(sub.first_name).toBe("Maya");
    expect(crm.kit.tagsOf(sub.id)).toEqual(["lead-magnet"]);
  });

  it("an email given before Kit is connected is pushed once it's connected (backfill)", async () => {
    w.connected.clear();
    await w.write("email", "maya@example.com", "system");
    await w.write("niche", "Coach");
    expect((await w.flush()).kit).toEqual({ status: "skipped", reason: "not connected" });
    w.connected.add("kit");
    expect((await w.flush()).kit).toMatchObject({ status: "synced" });
    expect(crm.kit.byEmail("maya@example.com")?.fields).toEqual({ niche: "Coach" });
  });

  it("a corrected email updates the same subscriber, never a second one", async () => {
    await w.write("email", "maya@gmial.com", "j");
    await w.write("niche", "Coach");
    await w.flush();
    const id = crm.kit.byEmail("maya@gmial.com")!.id;
    await w.write("email", "maya@gmail.com", "j");
    await w.flush();
    expect(crm.kit.subs.size).toBe(1);
    expect(crm.kit.subs.get(id)?.email_address).toBe("maya@gmail.com");
    expect(crm.kit.byEmail("maya@gmial.com")).toBeNull();
  });

  it("an existing subscriber is merged: their empty fields filled, their values kept, tags added", async () => {
    const old = crm.kit.addSubscriber("maya@example.com", { first_name: "Mayа (old)", fields: { niche: "Designer", revenue: null } });
    await w.write("email", "maya@example.com", "system");
    await w.write("niche", "Coach");
    await w.write("monthly_revenue", "$4,000");
    await addTag({ workspaceId: "w1", contactId: "c1", tag: "dm-lead", source: "system" }, w.tagDeps);
    await w.flush();
    expect(crm.kit.subs.size).toBe(1);
    expect(old.fields).toEqual({ niche: "Designer", revenue: "4000" });
    expect(old.first_name).toBe("Mayа (old)");
    expect(crm.kit.tagsOf(old.id)).toEqual(["dm-lead"]);
    // A later change of a value we put there does go through.
    await w.write("monthly_revenue", "6k");
    await w.flush();
    expect(old.fields.revenue).toBe("6000");
    expect(old.fields.niche).toBe("Designer");
  });

  it("a value that doesn't fit the type stays in DM OS, isn't pushed, and shows amber", async () => {
    await w.write("email", "maya@example.com", "system");
    await w.write("monthly_revenue", "it varies a lot");
    await w.flush();
    expect(crm.kit.byEmail("maya@example.com")?.fields).toEqual({});
    expect(w.value("monthly_revenue")).toBe("it varies a lot");
    const rows = detailsFields(
      [{ id: "f-rev", key: "monthly_revenue", label: "Monthly revenue", type: "NUMBER", builtIn: false, options: [], ghlField: null, kitField: "revenue", sortOrder: 0, usedBy: [] }],
      null,
      new Map([["monthly_revenue", { value: "it varies a lot", source: "j" as const, at: null }]]),
      {}
    );
    expect(rows[0].pushed).toBe(false);
  });

  it("CRM down: records 'failed + reason + at', rethrows for the queue's backoff, and the retry clears it", async () => {
    await w.write("email", "maya@example.com", "system");
    crm.fail(1, 429);
    expect((await w.flush()).kit.error).toMatch(/SyncApiError|rate/i);
    const failed = w.log.get("kit")!;
    expect(failed.lastError).toMatch(/rate limiting/);
    expect(failed.lastErrorAt).toBeInstanceOf(Date);
    expect((await w.flush()).kit).toMatchObject({ status: "synced" });
    expect(w.log.get("kit")?.lastError).toBeNull();
  });

  it("a removed mapping stops pushing that field; the value stays in DM OS", async () => {
    await w.write("email", "maya@example.com", "system");
    await w.write("niche", "Coach");
    w.fields.find((f) => f.key === "niche")!.kitField = null;
    await w.flush();
    expect(crm.kit.byEmail("maya@example.com")?.fields).toEqual({});
    expect(w.value("niche")).toBe("Coach");
  });

  it("stop = tag 'stopped' only: never unsubscribed", async () => {
    await w.write("email", "maya@example.com", "system");
    await w.flush();
    await markStopped("w1", "c1", w.tagDeps);
    await w.flush();
    const sub = crm.kit.byEmail("maya@example.com")!;
    expect(crm.kit.tagsOf(sub.id)).toEqual(["stopped"]);
    expect(sub.state).toBe("active");
    expect(crm.calls.some((c) => /unsubscribe/.test(c.path))).toBe(false);
  });

  it("tags are add-only: a tag that's just gone stays; removeTag removes it there", async () => {
    await w.write("email", "maya@example.com", "system");
    await addTag({ workspaceId: "w1", contactId: "c1", tag: "a", source: "step" }, w.tagDeps);
    await addTag({ workspaceId: "w1", contactId: "c1", tag: "b", source: "step" }, w.tagDeps);
    await w.flush();
    const sub = crm.kit.byEmail("maya@example.com")!;
    w.contact.tags = ["b"]; // dropped by something that isn't a removal step
    await w.flush();
    expect(crm.kit.tagsOf(sub.id)).toEqual(["a", "b"]);
    await removeTag({ workspaceId: "w1", contactId: "c1", tag: "b", source: "step" }, w.tagDeps);
    await w.flush();
    expect(crm.kit.tagsOf(sub.id)).toEqual(["a"]);
    expect(w.state.get("kit")?.removeTags).toEqual([]);
  });

  it("deleting in DM OS never deletes there: a cleared value and a gone contact push nothing", async () => {
    await w.write("email", "maya@example.com", "system");
    await w.write("niche", "Coach");
    await w.flush();
    await w.write("niche", null, "kevin");
    expect(w.dirty.length).toBe(0);
    await w.flush();
    expect(crm.kit.byEmail("maya@example.com")?.fields.niche).toBe("Coach");
    w.exists = false;
    crm.reset();
    expect((await w.flush()).kit).toEqual({ status: "skipped", reason: "no such contact" });
    expect(crm.calls).toEqual([]);
  });
});

describe("GoHighLevel", () => {
  beforeEach(() => {
    w.connected.add("ghl");
    w.mapping = { ...defaultMapping(), scope: "all", igHandle: "fIg" };
  });

  it("creates on IG handle + name when there's no email or phone (Q-F1), then updates the same contact", async () => {
    await w.write("niche", "Coach");
    expect((await w.flush()).ghl).toMatchObject({ status: "synced" });
    expect(crm.ghl.contacts.size).toBe(1);
    const c = [...crm.ghl.contacts.values()][0];
    expect(c).toMatchObject({ name: "Maya Lopez", firstName: "Maya", email: null });
    expect(c.customFields).toEqual({ fIg: "@maya.builds", fNiche: "Coach" });
    expect(crm.calls.find((x) => x.path === "/contacts/upsert")).toBeUndefined();

    await w.write("email", "maya@example.com", "step");
    await w.flush();
    expect(crm.ghl.contacts.size).toBe(1);
    expect(c.email).toBe("maya@example.com");
  });

  it("waits when there's nothing to identify them by", async () => {
    w.contact.username = null;
    expect((await w.flush()).ghl).toEqual({ status: "skipped", reason: "waits for contact info" });
  });

  it("creates on a phone, and merges into an existing contact found by phone", async () => {
    const old = crm.ghl.addContact({ phone: "+15550001", firstName: "M.", customFields: { fNiche: "Designer" }, tags: ["webinar"] });
    await w.write("phone", "+15550001", "step");
    await w.write("niche", "Coach");
    await w.write("monthly_revenue", "5k");
    await addTag({ workspaceId: "w1", contactId: "c1", tag: "dm-lead", source: "system" }, w.tagDeps);
    await w.flush();
    expect(crm.ghl.contacts.size).toBe(1);
    expect(old.customFields).toEqual({ fNiche: "Designer", fIg: "@maya.builds", fRev: "5000" });
    expect(old.firstName).toBe("M.");
    expect([...old.tags].sort()).toEqual(["dm-lead", "webinar"]);
  });

  it("a corrected email moves to the older lead when that email is already someone there", async () => {
    await w.write("email", "maya@gmial.com", "j");
    await w.flush();
    const older = crm.ghl.addContact({ email: "maya@gmail.com", customFields: { fNiche: "Designer" } });
    await w.write("email", "maya@gmail.com", "j");
    await w.write("niche", "Coach");
    expect((await w.flush()).ghl).toMatchObject({ status: "synced", externalId: older.id });
    expect(older.customFields.fNiche).toBe("Designer");
    expect(crm.calls.some((c) => c.method === "DELETE" && /^\/contacts\/[^/]+$/.test(c.path))).toBe(false);
  });

  it("a key-referenced field ('contact.dm_stage') is merged against its resolved id", async () => {
    const old = crm.ghl.addContact({ email: "maya@example.com", customFields: { fStage: "Webinar" } });
    await w.write("email", "maya@example.com", "system");
    await w.write("their_goal", "10k a month");
    await w.flush();
    expect(old.customFields.fStage).toBe("Webinar");
  });
});

describe("fillOnly", () => {
  it("fills empty, keeps theirs, overwrites only what we pushed", () => {
    expect(fillOnly({ a: "1", b: "2", c: "3", d: null }, { a: "", b: "theirs", c: "old" }, { c: "old" })).toEqual({
      send: { a: "1", c: "3" },
      pushed: { a: "1", c: "3" },
    });
  });
});
