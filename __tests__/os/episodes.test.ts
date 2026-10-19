import { describe, expect, it } from "vitest";
import { episodesFrom, type ResourceLike } from "../../lib/os/setter/kb";
import { episodesBlock } from "../../lib/os/setter/profile";
import { hostLabel, moveId, shortLink } from "../../lib/os/setter/knowledge/resources-view";

const ep = (id: string, extra: Partial<ResourceLike> = {}): ResourceLike => ({
  id,
  slug: id,
  kind: "episode",
  name: `Episode ${id}`,
  link: `https://youtu.be/${id}`,
  keyword: null,
  status: "ACTIVE",
  description: "",
  data: { when: `when ${id}` },
  ...extra,
});

describe("Best episodes", () => {
  it("drag: moving down lands after the target, moving up before it", () => {
    expect(moveId(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "c", "a", "d"]);
    expect(moveId(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"]);
    expect(moveId(["a", "b"], "a", "a")).toEqual(["a", "b"]);
    expect(moveId(["a", "b"], "x", "a")).toEqual(["a", "b"]);
  });

  it("only active episodes with a link reach J, in sort order, with 'when to share'", () => {
    const list = episodesFrom([ep("1"), ep("2", { status: "DRAFT" }), ep("3", { link: null }), ep("4", { kind: "resource" }), ep("5", { data: {}, description: "fallback" })]);
    expect(list.map((e) => e.name)).toEqual(["Episode 1", "Episode 5"]);
    expect(list[0].when).toBe("when 1");
    expect(list[1].when).toBe("fallback");
    const block = episodesBlock(list);
    expect(block).toMatch(/^### BEST EPISODES/);
    expect(block).toContain("1. **Episode 1**: https://youtu.be/1\n   when: when 1");
    expect(episodesBlock([])).toBe("");
  });

  it("labels links for the list", () => {
    expect(hostLabel("https://youtu.be/x")).toBe("YouTube");
    expect(hostLabel("https://www.youtube.com/watch?v=1")).toBe("YouTube");
    expect(shortLink("https://claudepreneur.com/starter/")).toBe("claudepreneur.com/starter");
  });
});
