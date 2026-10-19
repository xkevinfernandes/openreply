import { describe, expect, it } from "vitest";
import { daysLabel, keywordsFor, kindOf, sentCounts } from "../../lib/os/knowledge";
import { correctionPair } from "../../lib/os/setter/knowledge/corrections";
import { parseCorrections } from "../../lib/os/setter/profile";
import { loadKnowledge } from "../../lib/os/setter/knowledge";

describe("Resources: lead magnets view", () => {
  it("keywords = the resource's own word plus every campaign mapped to it, deduped", () => {
    const maps = [
      { automationId: "a1", resourceId: "r1" },
      { automationId: "a2", resourceId: "r2" },
    ];
    const autos = [
      { id: "a1", keywords: ["setter", "STARTER"] },
      { id: "a2", keywords: ["SCRIPT"] },
    ];
    expect(keywordsFor({ id: "r1", keyword: "SETTER" }, maps, autos)).toEqual([
      { word: "SETTER", automationId: "a1" },
      { word: "STARTER", automationId: "a1" },
    ]);
    expect(keywordsFor({ id: "r3", keyword: null }, maps, autos)).toEqual([]);
  });

  it("sent counts come from lead_magnet_sent events", () => {
    const m = sentCounts([{ data: { resourceId: "r1" } }, { data: { resourceId: "r1" } }, { data: { resourceId: "r2" } }, { data: null }, { data: { x: 1 } }]);
    expect(m.get("r1")).toBe(2);
    expect(m.get("r2")).toBe(1);
  });

  it("episodes are their own kind; no price anywhere", () => {
    expect(kindOf("episode")).toBe("episode");
    expect(kindOf("setter")).toBe("setter");
    expect(kindOf("anything")).toBe("resource");
  });

  it("working days read like the board", () => {
    expect(daysLabel([1, 2, 3, 4, 5])).toBe("Mon–Fri");
    expect(daysLabel([1, 3])).toBe("Mon, Wed");
  });
});

describe("helper panel: voice corrections as two lines", () => {
  it("reads both log formats", () => {
    const list = parseCorrections(loadKnowledge().voiceCorrections);
    const pinned = correctionPair(list[0]);
    expect(pinned.wrote).toMatch(/^so would you be down for a quick call/);
    expect(pinned.sent).toMatch(/^want to jump on a quick call/);
    const logged = correctionPair(list.find((c) => c.title.startsWith("Correction 1"))!);
    expect(logged.wrote).toMatch(/^oh nice, a podcast is honestly/);
    expect(logged.sent).toMatch(/^oh nice, a podcast is one of/);
    expect(logged.who).toBe("@newlead_test");
  });
});

describe("helper panel: rejected / chosen corrections", () => {
  it("reads the Rejected / Chosen format", () => {
    const list = parseCorrections(loadKnowledge().voiceCorrections);
    const c = correctionPair(list.find((x) => x.title.startsWith("Correction 4"))!);
    expect(c.wrote).toMatch(/^ha love the honesty dude/);
    expect(c.sent).toMatch(/^ha all good, I'm not here to sell you anything/);
  });
});
