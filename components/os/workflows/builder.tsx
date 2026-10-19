"use client";

// The workflow builder (WorkflowA board, the free canvas): header with name,
// Draft/Auto, On/Off and Publish, the results strip, the React Flow canvas
// with the step palette drawer, and the inspector for the selected step.
// The graph only changes through graph-edit.ts; edits autosave as the draft.

import "@xyflow/react/dist/style.css";
import "@/components/os/workflows/workflows.css";
import Link from "next/link";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { publishWorkflowAction, saveWorkflowDraft, setWorkflowMode, setWorkflowOn } from "@/app/(os)/os/automations/workflows/actions";
import { friendlyProblems, PALETTE, problemsByNode, STEP_LABEL, TRIGGER_KIND_LABEL } from "@/components/os/workflows/forms";
import {
  addNode,
  commit,
  connect,
  connectProblem,
  historyOf,
  moveNode,
  nodeById,
  redo,
  removeEdges,
  removeNodes,
  replace,
  undo,
  updateNodeData,
  type History,
} from "@/components/os/workflows/graph-edit";
import { WfIcon } from "@/components/os/workflows/icons";
import Inspector from "@/components/os/workflows/inspector";
import { StepNode, type StepNodeData, type StepNodeType } from "@/components/os/workflows/step-node";
import type { BuilderContext } from "@/components/os/workflows/context";
import type { WorkflowDetail, WorkflowMode, WorkflowStats } from "@/components/os/workflows/types";
import { sinceLabel, stripItems } from "@/components/os/workflows/view";
import { InfoTip } from "@/components/os/ui";
import type { GraphProblem, StepData, StepType, WorkflowGraph } from "@/lib/os/workflows/graph";

const NODE_TYPES = { step: StepNode };
const DND_TYPE = "application/x-wf-step";

type SaveState = "saved" | "saving" | "error";

export interface BuilderProps {
  workflow: WorkflowDetail;
  stats: WorkflowStats | null;
  ctx: Omit<BuilderContext, "stats">;
}

export default function Builder(props: BuilderProps) {
  return (
    <ReactFlowProvider>
      <BuilderInner {...props} />
    </ReactFlowProvider>
  );
}

function BuilderInner({ workflow, stats, ctx: baseCtx }: BuilderProps) {
  const rf = useReactFlow();
  const [hist, setHist] = useState<History>(() => historyOf(workflow.graph));
  const graph = hist.present;
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const [palette, setPalette] = useState(false);
  const [name, setName] = useState(workflow.name);
  const [mode, setMode] = useState<WorkflowMode>(workflow.mode);
  const [on, setOn] = useState(workflow.on);
  const [version, setVersion] = useState(workflow.version);
  const [unpublished, setUnpublished] = useState(workflow.unpublished);
  const [save, setSave] = useState<SaveState>("saved");
  const [showProblems, setShowProblems] = useState(false);
  const [serverProblems, setServerProblems] = useState<GraphProblem[]>([]);
  const [note, setNote] = useState<{ text: string; tone?: "bad" } | null>(null);
  const [publishing, startPublish] = useTransition();

  const ctx: BuilderContext = useMemo(() => ({ ...baseCtx, stats }), [baseCtx, stats]);
  const problems = useMemo(() => (showProblems ? [...friendlyProblems(graph), ...serverProblems] : []), [showProblems, graph, serverProblems]);
  const marks = useMemo(() => problemsByNode(problems), [problems]);

  // Latest graph and name for callbacks that outlive a render.
  const graphRef = useRef(graph);
  const nameRef = useRef(name);
  useLayoutEffect(() => {
    graphRef.current = graph;
    nameRef.current = name;
  });

  // ---------------------------------------------------------------- autosave
  const first = useRef(true);
  const savedGraph = useRef(workflow.graph);
  const savedName = useRef(workflow.name);
  const flush = useCallback(async () => {
    const g = graphRef.current;
    const n = nameRef.current;
    const input: { graph?: WorkflowGraph; name?: string } = {};
    if (g !== savedGraph.current) input.graph = g;
    if (n !== savedName.current && n.trim()) input.name = n;
    if (!input.graph && !input.name) return true;
    setSave("saving");
    const r = await saveWorkflowDraft(workflow.id, input);
    if (r.error !== undefined) {
      setSave("error");
      setNote({ text: r.error, tone: "bad" });
      return false;
    }
    if (input.graph) {
      savedGraph.current = input.graph;
      setUnpublished(true);
    }
    if (input.name) savedName.current = input.name;
    setSave("saved");
    return true;
  }, [workflow.id]);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setServerProblems([]);
    const t = setTimeout(() => void flush(), 700);
    return () => clearTimeout(t);
  }, [graph, name, flush]);

  // ---------------------------------------------------------------- edits
  const lastEdit = useRef<{ id: string; at: number } | null>(null);
  const apply = useCallback((fn: (g: WorkflowGraph) => WorkflowGraph) => setHist((h) => commit(h, fn(h.present))), []);
  /** Typing in the inspector: one undo step per pause, not per key. */
  const editData = useCallback((id: string, data: unknown) => {
    const now = Date.now();
    const coalesce = lastEdit.current?.id === id && now - lastEdit.current.at < 1000;
    lastEdit.current = { id, at: now };
    setHist((h) => (coalesce ? replace(h, updateNodeData(h.present, id, data)) : commit(h, updateNodeData(h.present, id, data))));
  }, []);

  const dragStart = useRef<WorkflowGraph | null>(null);
  const onNodesChange = useCallback(
    (changes: NodeChange<StepNodeType>[]) => {
      const removed: string[] = [];
      const dims: Record<string, { width: number; height: number }> = {};
      for (const c of changes) {
        if (c.type === "position" && c.position) {
          const pos = c.position;
          setHist((h) => {
            if (c.dragging && !dragStart.current) dragStart.current = h.present;
            const moved = moveNode(h.present, c.id, pos);
            return replace(h, moved);
          });
        } else if (c.type === "dimensions" && c.dimensions) dims[c.id] = c.dimensions;
        else if (c.type === "select" && c.selected) {
          setSelected(c.id);
          setSelectedEdge(null);
        } else if (c.type === "remove") removed.push(c.id);
      }
      if (Object.keys(dims).length) setMeasured((m) => ({ ...m, ...dims }));
      if (removed.length) {
        apply((g) => removeNodes(g, removed));
        setSelected((s) => (s && removed.includes(s) && nodeById(graphRef.current, s)?.type !== "trigger" ? null : s));
      }
    },
    [apply]
  );
  const onNodeDragStop = useCallback(() => {
    const before = dragStart.current;
    dragStart.current = null;
    if (before) setHist((h) => (h.present === before ? h : { past: [...h.past, before].slice(-60), present: h.present, future: [] }));
  }, []);

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removed = changes.filter((c) => c.type === "remove").map((c) => c.id);
      for (const c of changes) if (c.type === "select" && c.selected) setSelectedEdge(c.id);
      if (removed.length) {
        apply((g) => removeEdges(g, removed));
        setSelectedEdge(null);
      }
    },
    [apply]
  );

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target) return;
    apply((g) => connect(g, c.source, c.sourceHandle ?? "next", c.target));
  }, [apply]);
  const isValidConnection = useCallback(
    (c: Connection | Edge) => !connectProblem(graphRef.current, c.source, c.sourceHandle ?? "next", c.target),
    []
  );

  const addAt = useCallback(
    (type: StepType, position?: { x: number; y: number }) => {
      let pos = position;
      if (!pos) {
        const el = document.querySelector(".wf-canvas");
        const r = el?.getBoundingClientRect();
        pos = rf.screenToFlowPosition({ x: (r?.left ?? 0) + (r?.width ?? 800) / 2 - 100, y: (r?.top ?? 0) + (r?.height ?? 600) / 2 - 50 });
      }
      let newId = "";
      setHist((h) => {
        const r = addNode(h.present, type, pos!);
        newId = r.id;
        return commit(h, r.graph);
      });
      setSelected(newId || null);
      setPalette(false);
    },
    [rf]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      const type = e.dataTransfer.getData(DND_TYPE) as StepType;
      if (!type) return;
      e.preventDefault();
      addAt(type, rf.screenToFlowPosition({ x: e.clientX - 100, y: e.clientY - 20 }));
    },
    [addAt, rf]
  );

  // Undo / redo from the keyboard (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable=true]")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        setHist((h) => (e.shiftKey ? redo(h) : undo(h)));
      } else if (e.key === "Escape") {
        setSelected(null);
        setPalette(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---------------------------------------------------------------- view
  const nodes: StepNodeType[] = useMemo(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: "step",
        position: n.position,
        data: { node: n, problems: marks[n.id] ?? [], ctx } satisfies StepNodeData,
        selected: n.id === selected,
        deletable: n.type !== "trigger",
        measured: measured[n.id],
      })),
    [graph.nodes, marks, ctx, selected, measured]
  );
  const edges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        source: e.from,
        sourceHandle: e.fromPort,
        target: e.to,
        targetHandle: "in",
        type: "default",
        selected: e.id === selectedEdge,
        className: e.fromPort.startsWith("exit:") || e.fromPort === "timeout" || e.fromPort === "no" ? "wf-edge-alt" : undefined,
      })),
    [graph.edges, selectedEdge]
  );

  const selectedNode = nodeById(graph, selected);
  const trig = graph.nodes.find((n) => n.type === "trigger");
  const trigData = trig?.data as StepData<"trigger"> | undefined;

  // ---------------------------------------------------------------- header actions
  function publish() {
    setNote(null);
    startPublish(async () => {
      const own = friendlyProblems(graphRef.current);
      if (own.length) {
        setShowProblems(true);
        setSelected(own.find((p) => p.nodeId)?.nodeId ?? null);
        return;
      }
      if (!(await flush())) return;
      const r = await publishWorkflowAction(workflow.id);
      if (r.error !== undefined) {
        setNote({ text: r.error, tone: "bad" });
        return;
      }
      if (r.problems?.length) {
        setServerProblems(r.problems);
        setShowProblems(true);
        setSelected(r.problems.find((p) => p.nodeId)?.nodeId ?? null);
        return;
      }
      setShowProblems(false);
      setServerProblems([]);
      setVersion(r.version ?? version);
      setUnpublished(false);
      setOn(true);
      setNote({ text: `Published v${r.version}` });
    });
  }

  async function changeMode(m: WorkflowMode) {
    const prev = mode;
    setMode(m);
    const r = await setWorkflowMode(workflow.id, m);
    if (r.error !== undefined) {
      setMode(prev);
      setNote({ text: r.error, tone: "bad" });
    }
  }

  async function toggleOn() {
    const next = !on;
    setOn(next);
    const r = await setWorkflowOn(workflow.id, next);
    if (r.error !== undefined) {
      setOn(!next);
      setNote({ text: r.error, tone: "bad" });
    }
  }

  useEffect(() => {
    if (!note || note.tone === "bad") return;
    const t = setTimeout(() => setNote(null), 2500);
    return () => clearTimeout(t);
  }, [note]);

  const strip = stats ? stripItems(stats.strip) : [];
  const problemCount = problems.length;

  return (
    <div className="wf-builder os-wfb">
      <header className="wf-head">
        <div className="wf-head-row">
          <Link href="/os/automations/workflows" className="wf-iconbtn" aria-label="Back to workflows" title="Workflows">
            <WfIcon name="back" />
          </Link>
          <input className="wf-name" value={name} aria-label="Workflow name" onChange={(e) => setName(e.target.value.slice(0, 80))} />
          {trigData ? (
            <button type="button" className="wf-trig-chip" title={`${TRIGGER_KIND_LABEL[trigData.kind]}${trigData.postIds === "any" ? " · any post" : ""}`} onClick={() => setSelected(trig!.id)}>
              <WfIcon name={trigData.kind} size={13} />
              {trigData.keywords.length ? trigData.keywords.map((k) => <b key={k}>{k}</b>) : <span className="wf-ghost">Keyword</span>}
            </button>
          ) : null}
          <span className="wf-grow" />
          <span className="wf-save" data-state={save} role="status">
            {save === "saving" ? "Saving…" : save === "error" ? "Not saved" : unpublished ? (version ? "Draft changes" : "Saved") : version ? `v${version}` : "Saved"}
          </span>
          <div className="wf-seg" role="radiogroup" aria-label="Mode">
            {(["draft", "auto"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => mode !== m && void changeMode(m)}>
                <span className="wf-mode-dot" data-mode={m} />
                {m === "draft" ? "Draft" : "Auto"}
              </button>
            ))}
          </div>
          <InfoTip label="Draft and Auto">Draft: J&apos;s messages wait for your approval in the Inbox. Auto: they send on their own. Your own Message steps always send.</InfoTip>
          <button type="button" className="os-switch" role="switch" aria-checked={on} aria-label={on ? "On" : "Off"} title={on ? "On: new people enter" : "Off: no new runs"} onClick={() => void toggleOn()}>
            <span className="os-switch-knob" />
          </button>
          <button type="button" className="os-button primary wf-publish" disabled={publishing} aria-busy={publishing} onClick={publish}>
            {publishing ? "Publishing…" : "Publish"}
          </button>
        </div>
        <div className="wf-strip" aria-label="Workflow results">
          {strip.map((s, i) => (
            <span key={s.label} className="wf-strip-item">
              {i > 0 ? <WfIcon name="arrow" size={12} className="wf-strip-arrow" /> : null}
              <span className="wf-strip-label">{s.label}</span>
              <b>{s.n}</b>
              <span className="wf-strip-pct">{s.pct}</span>
            </span>
          ))}
          <span className="wf-grow" />
          {problemCount ? (
            <button type="button" className="wf-problems" onClick={() => setSelected(problems.find((p) => p.nodeId)?.nodeId ?? selected)}>
              <span className="os-dot" data-tone="bad" aria-hidden="true" />
              {problemCount === 1 ? problems[0].message : `${problemCount} to fix`}
            </button>
          ) : null}
          {note ? (
            <span className="wf-note" data-tone={note.tone} role={note.tone === "bad" ? "alert" : "status"}>
              {note.text}
            </span>
          ) : null}
          {stats?.since ? <span className="wf-since">{sinceLabel(stats.since)}</span> : null}
        </div>
      </header>

      <div className="wf-body">
        <section className="wf-canvas" aria-label="Workflow canvas" onDragOver={(e) => {
            if (e.dataTransfer.types.includes(DND_TYPE)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          }} onDrop={onDrop}>
          <ReactFlow<StepNodeType, Edge>
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={onNodeDragStop}
            isValidConnection={isValidConnection}
            onPaneClick={() => {
              setSelected(null);
              setSelectedEdge(null);
            }}
            deleteKeyCode={["Backspace", "Delete"]}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            minZoom={0.25}
            maxZoom={1.75}
            defaultEdgeOptions={{ type: "default" }}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgb(17 17 17 / 0.08)" />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap position="bottom-right" pannable zoomable nodeColor="rgb(17 17 17 / 0.14)" nodeStrokeWidth={0} maskColor="rgb(247 247 245 / 0.7)" ariaLabel="Minimap" />
          </ReactFlow>

          <div className="wf-tools">
            <button type="button" className="wf-tool" aria-expanded={palette} aria-controls="wf-palette" onClick={() => setPalette((p) => !p)}>
              <WfIcon name="plus" />
              Step
            </button>
            <div className="wf-tool-group">
              <button type="button" className="wf-iconbtn" aria-label="Undo" title="Undo (⌘Z)" disabled={!hist.past.length} onClick={() => setHist(undo)}>
                <WfIcon name="undo" />
              </button>
              <button type="button" className="wf-iconbtn" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!hist.future.length} onClick={() => setHist(redo)}>
                <WfIcon name="redo" />
              </button>
            </div>
          </div>

          {palette ? (
            <nav id="wf-palette" className="wf-palette" aria-label="Steps">
              <div className="wf-palette-head">
                <h2>Steps</h2>
                <button type="button" className="wf-iconbtn" aria-label="Close steps" title="Close" onClick={() => setPalette(false)}>
                  <WfIcon name="close" />
                </button>
              </div>
              {PALETTE.map((p) => (
                <button
                  key={p.type}
                  type="button"
                  draggable
                  className="wf-palette-item"
                  title={p.tip}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DND_TYPE, p.type);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => addAt(p.type)}
                >
                  <span className="wf-palette-icon">
                    <WfIcon name={p.type} />
                  </span>
                  <span>{STEP_LABEL[p.type]}</span>
                  <WfIcon name="grip" className="wf-palette-grip" />
                </button>
              ))}
            </nav>
          ) : null}
        </section>

        {selectedNode ? (
          <Inspector
            key={selectedNode.id}
            workflowId={workflow.id}
            node={selectedNode}
            graph={graph}
            ctx={ctx}
            problems={marks[selectedNode.id] ?? []}
            onChange={(data) => editData(selectedNode.id, data)}
            onGraph={(fn) => apply(fn)}
            onDelete={() => {
              apply((g) => removeNodes(g, [selectedNode.id]));
              setSelected(null);
            }}
            onClose={() => setSelected(null)}
          />
        ) : null}
      </div>
    </div>
  );
}

export type { Node };
