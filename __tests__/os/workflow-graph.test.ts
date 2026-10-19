import { describe, expect, it } from "vitest";
import { portsOf, validateGraph, type WorkflowGraph } from "@/lib/os/workflows/graph";

const base: WorkflowGraph = {
  version: 1,
  nodes: [
    { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { kind: "comment", keywords: ["SETTER"] } },
    { id: "m", type: "message", position: { x: 0, y: 100 }, data: { bubbles: [{ kind: "text", text: "hey! want me to drop it below?" }] } },
    { id: "j", type: "setter", position: { x: 0, y: 200 }, data: { goal: "book_call", leadMagnet: { mode: "hold", resources: ["setter-starter"] } } },
  ],
  edges: [
    { id: "e1", from: "t", fromPort: "next", to: "m" },
    { id: "e2", from: "m", fromPort: "next", to: "j" },
  ],
};

describe("workflow graph", () => {
  it("accepts a valid graph", () => expect(validateGraph(base)).toEqual([]));
  it("needs exactly one trigger", () => {
    expect(validateGraph({ ...base, nodes: base.nodes.filter((n) => n.type !== "trigger"), edges: [base.edges[1]] })).toContainEqual({ message: "A workflow needs exactly one trigger" });
  });
  it("rejects unknown ports and double ports", () => {
    const g = { ...base, edges: [...base.edges, { id: "e3", from: "m", fromPort: "next", to: "j" }, { id: "e4", from: "j", fromPort: "next", to: "m" }] };
    const msgs = validateGraph(g).map((p) => p.message);
    expect(msgs).toContain("Two arrows leave the same port");
    expect(msgs).toContain("Unknown port next");
  });
  it("lists setter exits, buttons and branches as ports", () => {
    expect(portsOf({ type: "setter", data: {} })).toContain("exit:booked");
    expect(portsOf({ type: "message", data: { bubbles: [{ kind: "buttons", text: "x", buttons: [{ id: "yes", label: "Send it" }] }] } })).toEqual(["button:yes"]);
    expect(portsOf({ type: "randomizer", data: { branches: [{ id: "a", label: "A", weight: 1 }, { id: "b", label: "B", weight: 1 }] } })).toEqual(["branch:a", "branch:b"]);
  });
});
