import { describe, expect, it } from "vitest";
import {
  chordHref,
  contactHref,
  instagramHref,
  matchRange,
  parseQuery,
  score,
  searchPalette,
  snippet,
  threadFromUrl,
  type PaletteContact,
  type PaletteDoc,
} from "@/lib/os/palette/search";

const c = (over: Partial<PaletteContact>): PaletteContact => ({
  id: "c",
  username: null,
  fullName: null,
  conversationId: null,
  stage: null,
  draftWaiting: false,
  setterId: null,
  ...over,
});

const contacts = [
  c({ id: "c1", username: "maya.builds", fullName: "Maya", conversationId: "m1", stage: "Qualify", draftWaiting: true }),
  c({ id: "c2", username: "tom.k", conversationId: "m2" }),
  c({ id: "c3", username: "jordan.ops", conversationId: "m3", draftWaiting: true }),
  c({ id: "c4", username: "amaya_x", conversationId: "m4" }),
];
const docs: PaletteDoc[] = [{ setterId: "j", setterName: "J", key: "offers", file: "Offers.md", href: "/os/knowledge/j?doc=offers" }];

describe("palette search", () => {
  it("ranks prefix over substring", () => {
    const r = searchPalette("maya", { contacts, docs }, false);
    expect(r.contacts.map((x) => x.id)).toEqual(["c1", "c4"]);
    expect(r.actions).toEqual([]);
  });

  it("actions only with a thread open, and > shows only actions", () => {
    expect(searchPalette("approve", { contacts, docs }, true).actions[0].key).toBe("approve");
    const only = searchPalette(">", { contacts, docs }, true);
    expect(only.contacts).toEqual([]);
    expect(only.screens).toEqual([]);
    expect(only.actions.map((a) => a.key)).toEqual(["approve", "hold", "regenerate", "focus-draft", "move-stage", "send-resource", "open-instagram"]);
    expect(searchPalette("> stage", { contacts, docs }, true).actions.map((a) => a.key)).toEqual(["move-stage"]);
  });

  it("typing the open thread's name lists all its actions", () => {
    const r = searchPalette("maya", { contacts, docs }, true, contacts[0]);
    expect(r.contacts[0].id).toBe("c1");
    expect(r.actions).toHaveLength(7);
    expect(searchPalette("tom", { contacts, docs }, true, contacts[0]).actions).toEqual([]);
  });

  it("finds screens by name or alias, and docs by file name", () => {
    expect(searchPalette("follow", { contacts, docs }, false).screens[0].key).toBe("followups");
    expect(searchPalette("experiments", { contacts, docs }, false).screens[0].key).toBe("tests");
    expect(searchPalette("offers", { contacts, docs }, false).docs[0].file).toBe("Offers.md");
  });

  it("empty query: waiting threads and the G-chord screens", () => {
    const r = searchPalette("", { contacts, docs }, false);
    expect(r.contacts.map((x) => x.id)).toEqual(["c1", "c3"]);
    expect(r.screens.every((s) => s.chord)).toBe(true);
  });

  it("score and highlight", () => {
    expect(score("maya.builds", "maya")).toBeGreaterThan(score("amaya_x", "maya"));
    expect(score("tom.k", "zzz")).toBe(0);
    expect(score("jordan.ops", "jops")).toBe(10);
    expect(matchRange("maya.builds", "MAYA")).toEqual([0, 4]);
    expect(parseQuery(">  hold")).toEqual({ text: "hold", actionsOnly: true });
  });

  it("chords, hrefs and the open thread", () => {
    expect(chordHref("f")).toBe("/os/follow-ups");
    expect(chordHref("x")).toBeNull();
    expect(contactHref(contacts[0])).toBe("/os/inbox?c=m1");
    expect(contactHref(c({ id: "x" }))).toBe("/os/contacts?contact=x");
    expect(instagramHref("maya.builds")).toBe("https://ig.me/m/maya.builds");
    expect(threadFromUrl("/os/inbox", "?c=m1", contacts)?.id).toBe("c1");
    expect(threadFromUrl("/os/contacts", "?contact=c2", contacts)?.id).toBe("c2");
    expect(threadFromUrl("/os/inbox", "", contacts)).toBeNull();
  });

  it("snippet around a doc hit", () => {
    expect(snippet("We use Notion for the CRM and onboarding docs.", "notion", 8)).toBe("We use Notion for the…");
  });
});
