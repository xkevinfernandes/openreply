import { describe, expect, it } from "vitest";
import {
  buildBroadcastPrompt,
  messageText,
  nearDuplicate,
  parseBroadcastDraft,
  personaliseOne,
  threadState,
  type PersonaliseInput,
} from "@/lib/os/broadcasts/personalise";
import { cleanLink, fillTemplate, firstNameOf, stripLinks, textBubbles, withLinkBubble } from "@/lib/os/broadcasts/template";
import type { BroadcastContact } from "@/lib/os/broadcasts/types";

const H = 3_600_000;
const at = new Date("2026-10-23T09:00:00Z");
const LINK = "https://youtu.be/claude-runs-my-dms";

function contact(id: string, over: Partial<BroadcastContact> = {}): BroadcastContact {
  return {
    contactId: id,
    username: `${id}.builds`,
    fullName: id[0].toUpperCase() + id.slice(1),
    kind: "SALES",
    paused: false,
    tags: ["follow-up-friday"],
    igUserId: id,
    conversationId: null,
    theirLastAt: new Date(at.getTime() - 2 * H).toISOString(),
    ourLastAt: new Date(at.getTime() - 1 * H).toISOString(),
    setterStage: "qualify",
    stage: null,
    notes: "gets 40-60 DMs a week",
    fields: [{ label: "Niche", value: "fitness coaching" }],
    ...over,
  };
}

function input(c: BroadcastContact, over: Partial<PersonaliseInput> = {}): PersonaliseInput {
  return { contact: c, template: "hey {first_name}, thought of you with this one\n{link}", followupTemplate: "no pressure to watch, curious what you think", link: LINK, at, recent: ["THEM: like 40-60 a week"], avoid: [], name: "Follow-up Friday", ...over };
}

describe("template rules", () => {
  it("first name, template fill, links never inside text", () => {
    expect(firstNameOf("Nora Lind", "nora.coaching")).toBe("Nora");
    expect(firstNameOf(null, "sam.creates")).toBe("sam");
    expect(fillTemplate("hey {first_name}, look {link}\n\n{link}", { first_name: "maya" })).toEqual(["hey maya, look"]);
    expect(stripLinks("watch this https://x.com/a now")).toBe("watch this now");
    expect(withLinkBubble(["hey https://evil.example/x", "watch"], LINK)).toEqual(["hey", "watch", LINK]);
    expect(textBubbles(["a", LINK], LINK)).toEqual(["a"]);
    expect(cleanLink("youtu.be/abc")).toBe("https://youtu.be/abc");
    expect(cleanLink("not a link")).toBeNull();
  });
});

describe("live vs quiet", () => {
  it("labels the thread at send time", () => {
    expect(threadState(contact("maya"), at)).toMatchObject({ live: true, label: "Live · Qualify" });
    const quiet = threadState(contact("sam", { theirLastAt: new Date(at.getTime() - 20 * H).toISOString(), ourLastAt: new Date(at.getTime() - 19 * H).toISOString(), setterStage: null }), at);
    expect(quiet).toMatchObject({ live: false, label: "Quiet 19h" });
    expect(quiet.brief).toMatch(/thought of you/);
  });
});

describe("broadcast prompt", () => {
  it("carries template, link rule, contact facts, thread state and what to avoid", () => {
    const p = buildBroadcastPrompt(input(contact("maya"), { avoid: ["hey sam, thought of you"] }));
    expect(p).toContain("DRAFT KIND: broadcast");
    expect(p).toContain("Never put the link in your bubbles");
    expect(p).toContain(`LINK (sent alone after your bubbles): ${LINK}`);
    expect(p).toContain("Niche: fitness coaching");
    expect(p).toContain("LIVE thread");
    expect(p).toContain('- "hey sam, thought of you"');
  });

  it("parses the model's object and strips links it slipped in", () => {
    expect(parseBroadcastDraft({ bubbles: ["btw just did this video " + LINK], followup: "watch whenever", reasoning: "live" })).toEqual({ bubbles: ["btw just did this video"], followup: ["watch whenever"], reasoning: "live" });
    expect(parseBroadcastDraft(null).bubbles).toEqual([]);
  });
});

describe("no two identical", () => {
  it("near-duplicates via similarity", () => {
    expect(nearDuplicate("hey nora, thought of you with this one", "hey sam, thought of you with this one")).toBe(true);
    expect(nearDuplicate("btw just did this video, it's your 40-60 DMs thing", "hey sam, no stress about last week, thought of you")).toBe(false);
    expect(nearDuplicate("Hey!", "hey")).toBe(true);
  });

  it("the link is its own bubble, and a model twin is rewritten", async () => {
    const twin = { bubbles: ["hey, thought of you with this one"], followup: ["no pressure"], reasoning: "x" };
    let calls = 0;
    const write = async () => {
      calls++;
      return calls < 2 ? twin : { bubbles: ["saw this and it's basically your DM pile, thought of you"], followup: ["no pressure"], reasoning: "y" };
    };
    const taken = [messageText(twin.bubbles, twin.followup)];
    const m = await personaliseOne(input(contact("maya")), taken, write);
    expect(calls).toBe(2);
    expect(m.bubbles.at(-1)).toBe(LINK);
    expect(m.bubbles.slice(0, -1).some((b) => b.includes("http"))).toBe(false);
    expect(m.bubbles[0]).toContain("DM pile");
  });

  it("without a model, a whole list comes out unique", async () => {
    const taken: string[] = [];
    const people = ["nora", "sam", "maya", "tom", "lena", "ava", "chris", "priya", "dev", "jo", "kim", "lee"];
    for (const [i, n] of people.entries()) {
      const quiet = i % 2 === 0;
      const c = contact(n, quiet ? { theirLastAt: new Date(at.getTime() - 20 * H).toISOString(), ourLastAt: new Date(at.getTime() - 20 * H).toISOString() } : {});
      const m = await personaliseOne(input(c), taken, null, i);
      const text = messageText(m.bubbles.slice(0, -1), m.followupBubbles);
      expect(taken.some((t) => nearDuplicate(t, text))).toBe(false);
      expect(m.bubbles.at(-1)).toBe(LINK);
      taken.push(text);
    }
    expect(new Set(taken).size).toBe(people.length);
  });

  it("a model failure falls back to the template, never blocks", async () => {
    const quiet = new Date(at.getTime() - 20 * H).toISOString();
    const m = await personaliseOne(input(contact("nora", { theirLastAt: quiet, ourLastAt: quiet })), [], async () => {
      throw new Error("rate limit");
    });
    expect(m.bubbles).toEqual(["hey nora, thought of you with this one", LINK]);
    expect(m.followupBubbles).toEqual(["no pressure to watch, curious what you think"]);
  });

  it("no follow-up template means no follow-up", async () => {
    const m = await personaliseOne(input(contact("maya"), { followupTemplate: null }), [], async () => ({ bubbles: ["btw"], followup: ["extra"] }));
    expect(m.followupBubbles).toEqual([]);
  });
});
