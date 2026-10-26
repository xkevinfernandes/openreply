// Workflows canvas (stream C2 wfcanvas): every step type's node face renders
// through React Flow (server render, nodes with a size so they're drawn),
// with its count · % and one handle per port.

import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReactFlow } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";
import type { BuilderContext } from "@/components/os/workflows/context";
import { defaultData } from "@/components/os/workflows/graph-edit";
import { StepNode } from "@/components/os/workflows/step-node";
// The Setter tab's line tests reach server actions; not needed here.
vi.mock("@/components/os/knowledge/line-tests", () => ({ default: () => null }));
import Inspector from "@/components/os/workflows/inspector";
import { AUTOSIZE_MIN_PX, fitTextarea } from "@/components/os/workflows/autosize";
import { templateGraph } from "@/components/os/workflows/templates";
import { portsOf, STEP_TYPES, type GraphNode } from "@/lib/os/workflows/graph";

const ctx: BuilderContext = {
  fields: [
    { key: "email", label: "Email", kit: true, ghl: true },
    { key: "niche", label: "Niche", kit: false, ghl: false },
  ],
  resources: [{ slug: "setter-starter", name: "Claude Code Setter Starter", link: "https://claudepreneur.com/starter" }],
  setters: [{ id: "j", name: "J", isDefault: true }],
  workflows: [{ id: "wf2", name: "Script Vault" }],
  lineTests: {},
  stats: {
    strip: { triggered: 64, replied: 41, leadMagnet: 26, booked: 6, showed: 4 },
    since: "2026-10-12",
    nodes: { opener: { reached: 41, share: 0.64 } },
    ports: { setter: { "exit:booked": 6 } },
    releases: {},
    branches: {},
    byReel: [],
  },
};

function render(nodes: GraphNode[], problems: Record<string, string[]> = {}) {
  // ReactFlow without a provider seeds its own store from these props, so
  // the server render draws the nodes.
  return renderToStaticMarkup(
    h(ReactFlow, {
      nodes: nodes.map((n) => ({ id: n.id, type: "step", position: n.position, width: 220, height: 120, data: { node: n, problems: problems[n.id] ?? [], ctx } })),
      edges: [],
      nodeTypes: { step: StepNode },
      width: 1200,
      height: 800,
    })
  );
}

describe("node faces", () => {
  it("renders every step type with a handle per port", () => {
    for (const type of STEP_TYPES) {
      const node: GraphNode = { id: "n1", type, position: { x: 0, y: 0 }, data: defaultData(type) };
      const html = render([node]);
      expect(html, type).toContain('class="wf-node"');
      const sources = (html.match(/react-flow__handle[^"]*source/g) ?? []).length;
      expect(sources, type).toBe(portsOf(node).length);
    }
  });

  it("shows the template's content, counts and setter summary", () => {
    const g = templateGraph("hold_lead_magnet", "setter-starter");
    const html = render(g.nodes, { trigger: ["Add a keyword"] });
    expect(html).toContain("caught your comment");
    expect(html).toContain("J · Book a call · Hold");
    expect(html).toContain("Claude Code Setter Starter");
    expect(html).toMatch(/41.*64%/);
    expect(html).toContain("Booked");
    expect(html).toContain("Add a keyword");
    expect(html).toContain('data-problem="true"');
  });
});

// Readability: the canvas shows the copy itself, and the inspector's
// textareas grow to fit it (Waitlist + questions has long multi-paragraph messages).
describe("readable copy", () => {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
  const g = templateGraph("waitlist_questions");
  const byId = (id: string) => g.nodes.find((n) => n.id === id)!;

  it("shows a message's full text (line breaks kept) and its buttons as chips", () => {
    const listed = byId("listed");
    const html = render([listed]);
    const b = (listed.data as { bubbles: { text: string }[] }).bubbles[0];
    expect(b.text).toContain("\n\n");
    expect(html).toContain(esc(b.text));
    expect(html).toContain('<span class="wf-port-chip" data-kind="button">Sure</span>');
    expect(html).toContain('<span class="wf-port-chip" data-kind="button">Maybe later</span>');
  });

  it("puts each chip's handle in the same row as the chip", () => {
    const html = render([byId("q_revenue")]);
    for (const id of ["none", "u5k", "5to10", "10to20", "20plus"]) {
      const row = html.match(new RegExp(`<div class="wf-port" data-port="reply:${id}" data-chip="reply">(.*?)</div></div>`))?.[1] ?? "";
      expect(row, id).toContain('class="wf-port-chip" data-kind="reply"');
      expect(row, id).toMatch(/data-handleid="reply:[^"]+"/);
      expect(row, id).toContain(`data-handleid="reply:${id}"`);
    }
    expect(html).toContain("$5K–$10K");
    expect(html).toContain("Roughly how much revenue is your business currently generating per month?");
  });

  it("shows an Ask question in full", () => {
    const ask = byId("email");
    const html = render([ask]);
    expect(html).toContain('class="wf-b wf-b-full"');
    expect(html).toContain(esc((ask.data as { question: string }).question));
  });

  it("renders the inspector's message, Ask question and retry as auto-growing textareas", () => {
    const base = { workflowId: "wf5", graph: g, ctx, problems: [], onChange: () => {}, onGraph: () => {}, onDelete: () => {}, onClose: () => {} };
    const listed = byId("listed");
    const msg = renderToStaticMarkup(h(Inspector, { ...base, node: listed }));
    expect(msg).toMatch(/<textarea[^>]*aria-label="Buttons text"[^>]*class="wf-autosize os-input wf-bubble-text"/);
    expect(msg).toContain(esc((listed.data as { bubbles: { text: string }[] }).bubbles[0].text));
    const ask = renderToStaticMarkup(h(Inspector, { ...base, node: byId("email") }));
    expect(ask.match(/<textarea[^>]*class="wf-autosize/g)?.length).toBe(2);
    expect(ask).toContain('aria-label="Retry message"');
  });
});

describe("fitTextarea", () => {
  it("sets the height from scrollHeight, collapsing first, with a min height", () => {
    const seen: string[] = [];
    const style = {
      get height() {
        return seen[seen.length - 1] ?? "";
      },
      set height(v: string) {
        seen.push(v);
      },
    };
    const el = { style, scrollHeight: 213.4 };
    expect(fitTextarea(el)).toBe(214);
    expect(seen).toEqual(["auto", "214px"]);
    el.scrollHeight = 20;
    expect(fitTextarea(el)).toBe(AUTOSIZE_MIN_PX);
    expect(el.style.height).toBe(`${AUTOSIZE_MIN_PX}px`);
    expect(fitTextarea(el, 30)).toBe(30);
    expect(fitTextarea(null)).toBe(0);
  });
});
