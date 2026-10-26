// The broadcast builder's edit order (final tester, item 1): New broadcast →
// rename → pick a tag → Save Who lost the tag. The rename saved on blur and
// disabled Save mid-click, and any saved step remounted every step's form.
// These pin the two fixes: saves run in order through one queue, and each
// step remounts only on its own fields.
import { describe, expect, it } from "vitest";
import { serialQueue, stepStamps } from "@/lib/os/broadcasts/builder-state";
import { createBroadcast, loadBroadcast, saveSteps, type EngineDeps } from "@/lib/os/broadcasts/engine";
import { createMemoryBroadcastStore } from "@/lib/os/mock-followups";
import type { BroadcastContact } from "@/lib/os/broadcasts/types";

const WS = "ws-1";
const tick = () => new Promise((r) => setTimeout(r, 1));

function person(id: string, tags: string[]): BroadcastContact {
  return {
    contactId: id, username: id, fullName: id, kind: "SALES", paused: false, tags, igUserId: `ig-${id}`, conversationId: `c-${id}`,
    theirLastAt: new Date(Date.now() - 3_600_000).toISOString(), ourLastAt: null, setterStage: "qualify", stage: null, notes: null, fields: [],
  };
}

function world() {
  const store = createMemoryBroadcastStore({ contacts: () => [person("a", ["hot"]), person("b", ["hot"]), person("c", ["cold"])], tagName: (id) => id.replace(/^tag-/, "") });
  const deps: EngineDeps = { store, background: async (t) => t(), timezone: async () => "Europe/Luxembourg", tagName: async (_w, id) => id.replace(/^tag-/, "") };
  return { store, deps };
}

describe("serialQueue", () => {
  it("runs jobs in the order they were added, even when an earlier one is slower or fails", async () => {
    const q = serialQueue();
    const seen: string[] = [];
    const slow = q(async () => {
      await tick();
      await tick();
      seen.push("rename");
    });
    const failing = q(async () => {
      seen.push("boom");
      throw new Error("x");
    });
    const save = q(async () => void seen.push("who"));
    await Promise.allSettled([slow, failing, save]);
    expect(seen).toEqual(["rename", "boom", "who"]);
    await expect(failing).rejects.toThrow("x");
  });
});

describe("New broadcast → rename → pick a tag → Save Who", () => {
  it("keeps both the name and the tag, whatever the order", async () => {
    for (const order of [["name", "who"], ["who", "name"]]) {
      const w = world();
      const r = await createBroadcast(WS, w.deps);
      if (!r.ok) throw new Error(r.error);
      const q = serialQueue();
      const jobs = order.map((step) =>
        q(() => (step === "name" ? saveSteps(WS, r.key, { name: "Webinar replay" }, {}, w.deps) : saveSteps(WS, r.key, { audienceTagId: "tag-hot" }, {}, w.deps)))
      );
      for (const j of await Promise.all(jobs)) expect(j.ok).toBe(true);
      const page = (await loadBroadcast(WS, r.key, w.deps))!;
      expect(page.broadcast.key).toBe(r.key);
      expect(page.broadcast.name).toBe("Webinar replay");
      expect(page.broadcast.audienceTagId).toBe("tag-hot");
      expect(page.who?.total).toBe(2);
    }
  });

  it("a rename or another step's save doesn't remount the Who form (unsaved picks survive)", async () => {
    const w = world();
    const r = await createBroadcast(WS, w.deps);
    if (!r.ok) throw new Error(r.error);
    const before = stepStamps((await w.store.get(WS, r.key))!);
    await saveSteps(WS, r.key, { name: "Renamed" }, {}, w.deps);
    const renamed = stepStamps((await w.store.get(WS, r.key))!);
    expect(renamed).toEqual(before);
    await saveSteps(WS, r.key, { bubbles: [{ type: "text", text: "hey" }] }, {}, w.deps);
    const messaged = stepStamps((await w.store.get(WS, r.key))!);
    expect(messaged.who).toBe(before.who);
    expect(messaged.start).toBe(before.start);
    expect(messaged.messages).not.toBe(before.messages);
    await saveSteps(WS, r.key, { audienceTagId: "tag-hot" }, {}, w.deps);
    const tagged = stepStamps((await w.store.get(WS, r.key))!);
    expect(tagged.messages).toBe(messaged.messages);
    expect(tagged.who).not.toBe(messaged.who);
  });
});
