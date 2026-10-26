// "New workflow" always asks for the keyword: 1. pick a template; 2. the
// keyword (required), an optional name and the trigger kind. The new
// workflow opens with its keyword set and the template's messages intact; a
// keyword that already lives somewhere (a live workflow, an OpenReply
// campaign, Zernio) is refused and nothing is created.

import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  workflows: [] as { id: string; name: string; active: boolean; currentVersionId: string | null }[],
  versions: [] as { id: string; workflowId: string; number: number; graph: unknown; keywords: string[]; publishedAt: Date }[],
  campaigns: [] as { id: string; name: string; keywords: string[]; postId: string | null; matchAnyPost: boolean; dmTriggerEnabled: boolean }[],
  resources: [] as { slug: string; name: string; keyword: string | null; status: string; data: unknown }[],
  created: [] as { name: string; draftGraph: unknown }[],
  draft: null as null | { id: string; workspaceId: string; draftGraph: unknown },
  updates: [] as unknown[],
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    workflow: {
      findMany: async ({ where }: { where: { name?: { startsWith: string }; active?: boolean } }) =>
        where.name ? db.workflows.filter((w) => w.name.startsWith(where.name!.startsWith)) : db.workflows.filter((w) => w.active && w.currentVersionId),
      findFirst: async () => db.draft,
      create: async ({ data }: { data: { name: string; draftGraph: unknown } }) => {
        db.created.push(data);
        return { id: `new${db.created.length}`, ...data };
      },
    },
    workflowVersion: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => db.versions.filter((v) => where.id.in.includes(v.id)), findFirst: async () => null },
    workflowRun: { findMany: async () => [] },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        workflowVersion: { create: async ({ data }: { data: object }) => ({ id: "v_new", ...data }) },
        workflow: {
          update: async (u: unknown) => {
            db.updates.push(u);
            return u;
          },
        },
      }),
    automation: { findMany: async () => db.campaigns },
    resource: { findMany: async () => db.resources },
  },
}));
vi.mock("@/app/(os)/os/automations/workflows/actions", () => ({ createWorkflowAction: async () => ({ error: "x" }) }));

import { TemplatePicker } from "@/components/os/workflows/workflow-list";
import { createWorkflow, publishWorkflow } from "@/lib/os/workflows/api-impl";
import type { StepData, WorkflowGraph } from "@/lib/os/workflows/graph";
import { templateGraph, TEMPLATES } from "@/lib/os/workflows/templates";
import { clashMessage } from "@/lib/os/workflows/triggers";

const trig = (g: WorkflowGraph) => g.nodes.find((n) => n.type === "trigger")!.data as StepData<"trigger">;
const withoutTrigger = (g: WorkflowGraph) => ({ ...g, nodes: g.nodes.filter((n) => n.type !== "trigger") });

beforeEach(() => {
  db.workflows = [];
  db.versions = [];
  db.campaigns = [];
  db.resources = [];
  db.created = [];
  db.draft = null;
  db.updates = [];
});

describe("New workflow picker", () => {
  it("step 1: the template cards, nothing created on open", () => {
    const html = renderToStaticMarkup(h(TemplatePicker, { onClose: () => {} }));
    expect(html).toContain("Start from");
    for (const t of TEMPLATES) expect(html).toContain(t.name);
    expect(html).toContain('class="wf-tpl"');
    expect(html).not.toContain('name="keyword"');
  });

  it("step 2: the template's name, a required Keyword (autofocus), an optional Name and the trigger kind; Create waits for a keyword", () => {
    const html = renderToStaticMarkup(h(TemplatePicker, { onClose: () => {}, initial: "waitlist_questions" }));
    expect(html).toContain("<h2>Waitlist + questions</h2>");
    const input = (name: string) => html.match(new RegExp(`<input[^>]*name="${name}"[^>]*/>`))?.[0] ?? "";
    expect(input("keyword")).toContain('placeholder="e.g. FOUNDER"');
    expect(input("keyword")).toContain('autofocus=""');
    expect(input("keyword")).toContain('required=""');
    expect(html).toContain(">Keyword<");
    expect(input("name")).toContain('placeholder="Waitlist + questions"');
    expect(input("name")).not.toContain("required");
    expect(html).toContain('role="radiogroup" aria-label="Trigger"');
    expect(html).toMatch(/aria-checked="true"[^>]*>Comment</);
    expect(html).toContain(">Story reply<");
    expect(html).toContain(">DM<");
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Create</);
    expect(html).toContain('aria-label="Back to templates"');
    expect(html).toContain(">Back<");
  });

  it("Blank still asks for the keyword", () => {
    const html = renderToStaticMarkup(h(TemplatePicker, { onClose: () => {}, initial: "blank" }));
    expect(html).toContain("<h2>Blank</h2>");
    expect(html).toContain('name="keyword"');
  });
});

describe("templateGraph with the keyword and trigger kind", () => {
  it("every template: the trigger has them; everything else is the template as it was", () => {
    for (const t of TEMPLATES) {
      const plain = templateGraph(t.id);
      const g = templateGraph(t.id, { keywords: ["FOUNDER"], kind: "story_reply" });
      expect(trig(g).keywords).toEqual(["FOUNDER"]);
      expect(trig(g).kind).toBe("story_reply");
      expect(trig(plain).keywords).toEqual([]);
      expect(trig(plain).kind).toBe("comment");
      expect(withoutTrigger(g)).toEqual(withoutTrigger(plain));
    }
  });

  it("keyword and keywords merge, trimmed, no repeats", () => {
    expect(trig(templateGraph("blank", { keyword: "A", keywords: [" A ", "B", ""] })).keywords).toEqual(["A", "B"]);
  });
});

describe("createWorkflow (engine API) with a keyword", () => {
  it("creates the workflow with its keyword and kind in the trigger, the template's messages intact", async () => {
    const r = await createWorkflow("ws", { templateId: "waitlist_questions", keywords: ["FOUNDER"], triggerKind: "comment" });
    expect(r).toEqual({ ok: true, id: "new1" });
    const g = db.created[0].draftGraph as WorkflowGraph;
    expect(trig(g).keywords).toEqual(["FOUNDER"]);
    expect(withoutTrigger(g)).toEqual(withoutTrigger(templateGraph("waitlist_questions")));
    expect(db.created[0].name).toBe("Waitlist + questions");
  });

  it("the name defaults to the template's, made unique; a typed name is kept", async () => {
    db.workflows = [{ id: "a", name: "Blank", active: false, currentVersionId: null }];
    await createWorkflow("ws", { templateId: "blank", keywords: ["ONE"] });
    await createWorkflow("ws", { templateId: "blank", keywords: ["TWO"], name: "Founder Engine" });
    expect(db.created.map((c) => c.name)).toEqual(["Blank 2", "Founder Engine"]);
  });

  it("a keyword that lives in a live workflow is refused and nothing is created", async () => {
    db.workflows = [{ id: "w1", name: "Founder Engine", active: true, currentVersionId: "v1" }];
    db.versions = [{ id: "v1", workflowId: "w1", number: 1, graph: templateGraph("waitlist_questions", { keyword: "FOUNDER" }), keywords: ["founder"], publishedAt: new Date() }];
    const r = await createWorkflow("ws", { templateId: "blank", keywords: ["founder"] });
    expect(r).toMatchObject({ ok: false, error: 'FOUNDER already lives in the workflow "Founder Engine". One keyword, one place.' });
    expect(db.created).toHaveLength(0);
    // A DM keyword doesn't clash with a comment one.
    expect(await createWorkflow("ws", { templateId: "blank", keywords: ["FOUNDER"], triggerKind: "dm" })).toMatchObject({ ok: true });
  });

  it("an OpenReply campaign or a Zernio keyword is refused too", async () => {
    db.campaigns = [{ id: "c1", name: "Old campaign", keywords: ["GUIDE"], postId: null, matchAnyPost: true, dmTriggerEnabled: false }];
    db.resources = [{ slug: "vault", name: "Script vault", keyword: "VAULT", status: "ACTIVE", data: {} }];
    expect(await createWorkflow("ws", { templateId: "send_link", keywords: ["GUIDE"] })).toMatchObject({ ok: false, error: 'GUIDE already lives in the campaign "Old campaign". One keyword, one place.' });
    expect(await createWorkflow("ws", { templateId: "send_link", keywords: ["vault"] })).toMatchObject({ ok: false, error: "VAULT already lives in Zernio (Script vault). One keyword, one place." });
    expect(db.created).toHaveLength(0);
  });

  it("without a keyword (other callers) it still creates, with an empty trigger", async () => {
    expect(await createWorkflow("ws", { templateId: "blank" })).toMatchObject({ ok: true });
    expect(trig(db.created[0].draftGraph as WorkflowGraph).keywords).toEqual([]);
  });

  it("clashMessage reads the same everywhere", () => {
    expect(clashMessage({ keyword: "founder", with: "workflow", id: "w", name: "X" })).toBe('FOUNDER already lives in the workflow "X". One keyword, one place.');
  });
});

describe("publishWorkflow (engine API)", () => {
  it("Publish puts the workflow live (on), as the builder shows it; before, a published workflow stayed Off", async () => {
    db.draft = { id: "w1", workspaceId: "ws", draftGraph: templateGraph("waitlist_questions", { keyword: "TESTKW" }) };
    expect(await publishWorkflow("ws", "w1", {})).toMatchObject({ ok: true, version: 1, versionId: "v_new" });
    expect(db.updates).toEqual([{ where: { id: "w1" }, data: { currentVersionId: "v_new", active: true } }]);
  });
});

describe("mock adapter (OS_MOCK=1)", () => {
  it("creates with the keyword, name and kind; refuses a live keyword", async () => {
    const prev = process.env.OS_MOCK;
    process.env.OS_MOCK = "1";
    const g = globalThis as { __osWorkflows?: unknown };
    delete g.__osWorkflows;
    try {
      const data = await import("@/components/os/workflows/data");
      await expect(data.createWorkflow("w", "blank", { keyword: "setter" })).rejects.toThrow(/SETTER already lives in the workflow/);
      const before = (await data.listWorkflows("w")).length;
      const { id } = await data.createWorkflow("w", "waitlist_questions", { keyword: "founder", name: "Founder Engine", kind: "comment" });
      const wf = (await data.getWorkflow("w", id))!;
      expect(wf.name).toBe("Founder Engine");
      expect(trig(wf.graph)).toMatchObject({ kind: "comment", keywords: ["FOUNDER"] });
      expect(wf.graph.nodes.filter((n) => n.type === "message").length).toBeGreaterThan(3);
      expect((await data.listWorkflows("w")).length).toBe(before + 1);
      const second = await data.createWorkflow("w", "blank", { keyword: "OTHER", kind: "dm" });
      expect((await data.getWorkflow("w", second.id))!.name).toBe("Blank");
      expect(trig((await data.getWorkflow("w", second.id))!.graph).kind).toBe("dm");
      await expect(data.createWorkflow("w", "blank", { keyword: "" })).rejects.toThrow("Add a keyword.");
    } finally {
      process.env.OS_MOCK = prev;
      delete g.__osWorkflows;
    }
  });
});
