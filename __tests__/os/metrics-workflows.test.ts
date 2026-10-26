import { describe, expect, it } from "vitest";
import { outcomeRow } from "@/lib/os/metrics";
import { qualifyingPorts, withWorkflows, workflowActivity, workflowRow, type WfEventLite, type WfRunLite } from "@/lib/os/metrics-workflows";
import { templateGraph } from "@/lib/os/workflows/templates";

const D = (s: string) => new Date(s);
const since = D("2026-10-19T00:00:00Z");
const now = D("2026-10-26T12:00:00Z");
const graph = templateGraph("waitlist_questions", { keyword: "FOUNDER" });
const graphs = new Map([["v1", graph]]);

const run = (id: string, over: Partial<WfRunLite> = {}): WfRunLite => ({ id, contactId: `c-${id}`, versionId: "v1", startedAt: D("2026-10-25T10:00:00Z"), endedAt: null, status: "WAITING", exit: null, ...over });
const ev = (runId: string, kind: string, over: Partial<WfEventLite> = {}): WfEventLite => ({ runId, nodeId: "join", kind, port: null, versionId: "v1", at: D("2026-10-25T10:05:00Z"), ...over });

describe("workflow activity on Home", () => {
  it("3 runs, 2 replies: started, replied, emails, finished and qualified for the period", () => {
    const runs = [run("a", { endedAt: D("2026-10-25T11:00:00Z"), status: "COMPLETED", exit: "completed" }), run("b"), run("c")];
    const events = [
      ev("a", "replied"),
      ev("a", "replied", { nodeId: "email", data: { saved: true, validate: "email" } }),
      ev("a", "leave", { nodeId: "q_revenue", port: "reply:10to20" }),
      ev("b", "replied"),
      ev("b", "replied", { nodeId: "email", data: { saved: false } }),
      ev("c", "leave", { nodeId: "trigger", port: "next" }),
    ];
    const a = workflowActivity(runs, events, graphs, since, now);
    expect(a).toEqual({ started: 3, replied: 2, emails: 1, finished: 1, qualified: 1, leadMagnets: 0 });
    expect(workflowRow(a).map((c) => [c.label, c.n, c.pct])).toEqual([
      ["Runs started", 3, null],
      ["Replied", 2, 67],
      ["Emails captured", 1, 33],
      ["Finished", 1, 33],
      ["Qualified", 1, 33],
    ]);
  });

  it("only the period counts", () => {
    const old = D("2026-10-01T10:00:00Z");
    const a = workflowActivity([run("a", { startedAt: old, endedAt: old, status: "COMPLETED", exit: "completed" })], [ev("a", "replied", { at: old })], graphs, since, now);
    expect(a).toMatchObject({ started: 0, replied: 0, finished: 0 });
  });

  it("qualifying options come from the graph ($5K+ revenue)", () => {
    expect([...qualifyingPorts(graph)].sort()).toEqual(["q_revenue:reply:10to20", "q_revenue:reply:20plus", "q_revenue:reply:5to10"]);
  });

  it("the outcome row is never empty while workflows run, without counting a contact twice", () => {
    const a = { started: 3, replied: 2, emails: 1, finished: 1, qualified: 1, leadMagnets: 1 };
    const counts = withWorkflows({ keyword_trigger: 2, conversation_started: 1 }, a, { counted: new Set(["c-a"]), repliedContacts: ["c-a", "c-b"] });
    expect(counts).toMatchObject({ keyword_trigger: 5, conversation_started: 2, lead_magnet_sent: 1 });
    expect(outcomeRow(withWorkflows({}, a, { counted: new Set(), repliedContacts: ["c-a", null] })).map((c) => c.n).slice(0, 3)).toEqual([3, 2, 1]);
  });
});
