import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { osNav } from "../../lib/os/nav";
import { removeAgentQuestion, saveSheet } from "../../lib/os/resource-sheet";
import { buildBoard, deleteBlockers, kindLabel, linkLabel, matchesFilter, offeringAgents, pillCounts, usedByOf } from "../../lib/os/resources-board";
import type { ResourceView } from "../../lib/os/knowledge";

const res = (id: string, slug: string, kind: ResourceView["kind"], setters: { id: string; name: string }[] = [], link: string | null = "https://x.com/a"): ResourceView => ({
  id,
  slug,
  kind,
  name: id,
  link,
  keyword: null,
  status: "ACTIVE",
  description: "",
  setterCount: setters.length,
  keywords: [],
  usedBy: setters,
  sent: 0,
  when: "",
  sortOrder: 0,
});

const inputs = {
  agents: [
    { id: "j", name: "J" },
    { id: "n", name: "Nova" },
  ],
  campaigns: [{ automationId: "a1", resourceId: "r1", name: "Campaign SETTER" }],
  workflows: [
    { id: "w1", name: "Workshop reminder", slugs: ["vault"] },
    { id: "w2", name: "Other", slugs: ["nothing"] },
  ],
};

describe("Resources: used by", () => {
  it("agents, campaigns, workflows (current version slugs) and Sequences via J", () => {
    const used = usedByOf({ id: "r1", slug: "vault" }, ["j", "n"], inputs);
    expect(used.map((u) => `${u.kind}:${u.name}`)).toEqual(["agent:J", "agent:Nova", "campaign:Campaign SETTER", "workflow:Workshop reminder", "sequences:Sequences via J"]);
    expect(used.find((u) => u.kind === "campaign")!.href).toBe("/os/automations/a1");
    expect(used.find((u) => u.kind === "workflow")!.href).toBe("/os/automations/workflows/w1");
    expect(usedByOf({ id: "r9", slug: "x" }, [], inputs)).toEqual([]);
  });

  it("delete is refused by campaigns and workflows; agents are only named in the confirm", () => {
    const used = usedByOf({ id: "r1", slug: "vault" }, ["j"], inputs);
    expect(deleteBlockers(used).map((b) => b.name)).toEqual(["Campaign SETTER", "Workshop reminder"]);
    expect(offeringAgents(used).map((b) => b.name)).toEqual(["J"]);
    expect(deleteBlockers(usedByOf({ id: "r2", slug: "free" }, ["j"], inputs))).toEqual([]);
  });

  it("pill counts leave entry paths out; kinds read as Lead magnet / Video", () => {
    const rows = [res("r1", "a", "resource"), res("r2", "b", "resource"), res("r3", "c", "episode"), res("r4", "d", "setter")];
    expect(pillCounts(rows, 3)).toEqual({ all: 3, magnets: 2, videos: 1, docs: 3 });
    expect(kindLabel("resource")).toBe("Lead magnet");
    expect(kindLabel("episode")).toBe("Video");
    expect(matchesFilter("setter", "all")).toBe(false);
    expect(matchesFilter("episode", "videos")).toBe(true);
    expect(matchesFilter("resource", "videos")).toBe(false);
    expect(linkLabel("https://www.kevinfernandes.me/setter-starter/")).toBe("kevinfernandes.me/setter-starter");
    expect(linkLabel(null)).toBeNull();
  });

  it("the board splits entry paths off and lists the knowledge docs with who has them", () => {
    const board = buildBoard([res("r1", "vault", "resource", [{ id: "j", name: "J" }]), res("r4", "entry", "setter")], new Map(), inputs, [{ setterId: "n", key: "offers" }]);
    expect(board.rows.map((r) => r.id)).toEqual(["r1"]);
    expect(board.entries.map((r) => r.id)).toEqual(["r4"]);
    expect(board.rows[0].agentIds).toEqual(["j"]);
    expect(board.docs.map((d) => d.name)).toEqual(["Business", "Offers", "Objections"]);
    const offers = board.docs.find((d) => d.key === "offers")!;
    expect(offers.agents.map((a) => a.name)).toEqual(["Nova"]);
    expect(offers.href).toBe("/os/knowledge/n?doc=offers");
  });
});

describe("Resources: the sheet", () => {
  it("onSaved gets the saved resource; an error doesn't call it", async () => {
    const onSaved = vi.fn();
    const saved = { id: "r1", name: "Vault", kind: "resource", link: null };
    expect(await saveSheet(async () => ({ resource: saved }), { name: "Vault" }, ["j"], onSaved)).toBeNull();
    expect(onSaved).toHaveBeenCalledWith(saved);
    const onSaved2 = vi.fn();
    expect(await saveSheet(async () => ({ error: "Give it a name." }), { name: "" }, [], onSaved2)).toBe("Give it a name.");
    expect(onSaved2).not.toHaveBeenCalled();
  });

  it("unticking an agent asks first", () => {
    expect(removeAgentQuestion("J")).toBe("Remove from J? J stops offering it, and J's sequences stop sending it.");
  });
});

describe("Resources: its own place", () => {
  it("nav points at /os/resources and the old route redirects there", () => {
    expect(osNav.find((n) => n.key === "resources")?.href).toBe("/os/resources");
    const old = readFileSync(path.resolve(__dirname, "../../app/(os)/os/knowledge/resources/page.tsx"), "utf8");
    expect(old).toMatch(/redirect\("\/os\/resources"\)/);
  });

  it("the OS_MOCK sample has every kind and is marked as sample", async () => {
    const { mockResourcesBoard } = await import("../../lib/os/mock-resources");
    const b = mockResourcesBoard();
    expect(b.sample).toBe(true);
    expect(b.counts.magnets).toBeGreaterThan(0);
    expect(b.counts.videos).toBeGreaterThan(0);
    expect(b.rows.some((r) => r.link === null)).toBe(true);
  });
});
