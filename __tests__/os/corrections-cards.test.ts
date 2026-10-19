import { describe, expect, it } from "vitest";
import { correctionBody, correctionPair } from "../../lib/os/setter/knowledge/corrections";
import { loadKnowledge } from "../../lib/os/setter/knowledge";
import { parseCorrections } from "../../lib/os/setter/profile";

describe("voice corrections as cards", () => {
  it("a hand-added correction reads back as J wrote / You sent / Why", () => {
    const body = correctionBody({ wrote: "hey there\nhow are you", sent: "yo", why: "too formal" });
    const p = correctionPair({ title: "Correction 3 (2026-10-19)", body });
    expect(p).toEqual({ wrote: "hey there how are you", sent: "yo", who: "2026-10-19", why: "too formal" });
  });

  it("no why: empty, and the sent line stops before any bullet", () => {
    const p = correctionPair({ title: "Correction 1 — @a (2026-06-10)", body: "**J drafted:**\n\n> a\n\n**Kevin sent:**\n\n> b\n\n**rules extracted:** _(pending distill)_" });
    expect(p).toMatchObject({ wrote: "a", sent: "b", who: "@a", why: "" });
  });

  it("reads the why from the real log's formats", () => {
    const list = parseCorrections(loadKnowledge().voiceCorrections);
    expect(correctionPair(list[0]).why).toMatch(/^never lower your frame/);
    const c3 = correctionPair(list.find((c) => c.title.startsWith("Correction 3"))!);
    expect(c3.wrote).toMatch(/^and level 0 is honestly fine/);
    expect(c3.sent).toMatch(/^and level 0 is actually fine/);
    expect(c3.why).toMatch(/^Jason Cooperson/);
    const c4 = correctionPair(list.find((c) => c.title.startsWith("Correction 4"))!);
    expect(c4.sent).not.toMatch(/Reasoning/);
  });
});
