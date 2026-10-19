import { describe, expect, it } from "vitest";
import { DOC_KEYS, docsFromProfile, profilePartsFromDocs } from "../../lib/os/setter/knowledge/docs";
import { fileSetter } from "../../lib/os/setter/knowledge";
import { docToMarkdown, markdownToDoc, roundTrip } from "../../lib/os/setter/knowledge/rich-md";

describe("rich editor markdown round trip", () => {
  const real = docsFromProfile(fileSetter().profile);

  it("parses every real doc to the same profile after Markdown → TipTap → Markdown", () => {
    for (const key of DOC_KEYS) {
      const doc = real[key];
      expect(profilePartsFromDocs({ [key]: roundTrip(doc) }), key).toEqual(profilePartsFromDocs({ [key]: doc }));
    }
  });

  it("keeps the real docs byte for byte", () => {
    for (const key of DOC_KEYS) expect(roundTrip(real[key]), key).toBe(real[key]);
  });

  it("keeps label lines, blank sections, lists, bold and links", () => {
    const md = "# Offers\n\n## Case\n\nStatus: open\nSold by: call\n\n## Proof\n\n## Never\n\n- a **b**\n  more\n  - c\n- [cal](https://cal.com/k) and https://x.com\n\n1. one\n2. two\n\n> q\n> ---\n> r\n";
    expect(roundTrip(md)).toBe(md);
    const doc = markdownToDoc("Status: open\nSold by: call");
    expect(doc.content).toHaveLength(1);
    expect(doc.content![0].content!.filter((n) => n.type === "hardBreak")).toHaveLength(1);
  });

  it("is stable after an edit-like reserialize", () => {
    for (const key of DOC_KEYS) {
      const once = roundTrip(real[key]);
      expect(docToMarkdown(markdownToDoc(once))).toBe(once);
    }
  });
});
