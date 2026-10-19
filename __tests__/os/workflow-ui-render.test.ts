// Workflows canvas (stream C2 wfcanvas): every step type's node face renders
// through React Flow (server render, nodes with a size so they're drawn),
// with its count · % and one handle per port.

import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReactFlow } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import type { BuilderContext } from "@/components/os/workflows/context";
import { defaultData } from "@/components/os/workflows/graph-edit";
import { StepNode } from "@/components/os/workflows/step-node";
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
