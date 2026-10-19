import { describe, expect, it } from "vitest";
import { REVISION_WINDOW_MS, startsNewRevision } from "../../lib/os/setter/knowledge/doc-store";
import { applyFormat, inline, joinBlocks, renderBlock, renderMarkdown, splitBlocks } from "../../lib/os/setter/knowledge/markdown";
import { docsFromProfile } from "../../lib/os/setter/knowledge/docs";
import { fileSetter } from "../../lib/os/setter/knowledge";

const at = (iso: string) => new Date(iso);

describe("History: one entry per editing session", () => {
  it("folds autosaves by the same person inside the window", () => {
    const last = { author: "kevin@x", createdAt: at("2026-10-19T10:00:00Z") };
    expect(startsNewRevision(last, "kevin@x", at("2026-10-19T10:05:00Z"))).toBe(false);
    expect(startsNewRevision(last, "kevin@x", new Date(last.createdAt.getTime() + REVISION_WINDOW_MS + 1))).toBe(true);
  });

  it("starts a new entry for someone else, or the first save", () => {
    expect(startsNewRevision(null, "kevin@x", at("2026-10-19T10:00:00Z"))).toBe(true);
    expect(startsNewRevision({ author: "import", createdAt: at("2026-10-19T10:00:00Z") }, "kevin@x", at("2026-10-19T10:01:00Z"))).toBe(true);
  });
});

describe("the doc editor's markdown", () => {
  it("splits into blocks losslessly (only the edited block ever changes)", () => {
    const samples = ["", "a", "a\n", "\n\na\n\n\nb\n", "# T\n\npara\nline\n\n- x\n  - y\n\n```\ncode\n\nmore\n```\n\nend", "a\n  \nb"];
    for (const s of samples) expect(joinBlocks(splitBlocks(s))).toBe(s);
    const real = docsFromProfile(fileSetter().profile);
    for (const body of Object.values(real)) expect(joinBlocks(splitBlocks(body))).toBe(body);
    expect(splitBlocks("```\na\n\nb\n```").filter((b) => b.text)).toHaveLength(1);
  });

  it("renders headings, lists, label lines and links, escaped", () => {
    expect(renderBlock("## Setter Build (1:1)")).toBe("<h2>Setter Build (1:1)</h2>");
    expect(renderBlock("- a\n  - b\n- c")).toBe("<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>");
    expect(renderBlock("Price: 3.5k\nFit: Owners")).toBe("<dl><dt>Price</dt><dd>3.5k</dd><dt>Fit</dt><dd>Owners</dd></dl>");
    expect(inline("**hi** <script>")).toBe("<strong>hi</strong> &lt;script&gt;");
    expect(inline("[x](javascript:alert(1))")).not.toContain("href");
    expect(inline("see https://cal.com/kevin")).toContain('href="https://cal.com/kevin"');
    expect(renderMarkdown("# A\n\nb")).toBe("<h1>A</h1><p>b</p>");
  });

  it("toolbar: H toggles a heading, B wraps, list toggles bullets", () => {
    expect(applyFormat("heading", { text: "Offers", selStart: 0, selEnd: 0 }).text).toBe("## Offers");
    expect(applyFormat("heading", { text: "## Offers", selStart: 3, selEnd: 3 }).text).toBe("Offers");
    expect(applyFormat("bold", { text: "say hi", selStart: 4, selEnd: 6 }).text).toBe("say **hi**");
    expect(applyFormat("list", { text: "a\nb", selStart: 0, selEnd: 3 }).text).toBe("- a\n- b");
  });
});
