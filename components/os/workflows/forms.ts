// Pure helpers behind the inspector forms and the node faces: bubble editing
// (a link is always its own bubble), buttons, randomizer weights, action ops,
// the A vs B results, step summaries and Publish problems in plain words.

import { lineVerdict, LINE_MIN_REACHED, pct, type LineVerdict } from "@/lib/os/experiments/stats";
import { portsOf, validateGraph, type Bubble, type GraphNode, type GraphProblem, type StepData, type StepType, type WorkflowGraph } from "@/lib/os/workflows/graph";

// ---------------------------------------------------------------- labels
export const STEP_LABEL: Record<StepType, string> = {
  trigger: "Trigger",
  message: "Message",
  wait: "Wait",
  ask: "Ask",
  condition: "Condition",
  action: "Action",
  randomizer: "Randomizer",
  setter: "Setter",
  goto: "Go to",
  end: "End",
};

/** The palette (WorkflowC drawer), in order. Hover text only, no captions. */
export const PALETTE: { type: StepType; tip: string }[] = [
  { type: "message", tip: "Text, buttons, quick replies, image, link" },
  { type: "wait", tip: "Delay, or until they reply" },
  { type: "ask", tip: "Email or an answer to a field" },
  { type: "condition", tip: "Follows, tag, field, keyword, stage" },
  { type: "action", tip: "Tag, field, Follow-up Friday" },
  { type: "randomizer", tip: "A/B split by %" },
  { type: "setter", tip: "J takes over with a goal" },
  { type: "goto", tip: "Another workflow" },
  { type: "end", tip: "Stop here" },
];

export const EXIT_LABEL: Record<string, string> = {
  booked: "Booked",
  quiet: "Quiet",
  not_a_fit: "Not a fit",
  stopped: "Stopped",
  goal_met: "Goal met",
};

export const RELEASE_RULES = [
  { key: "booked", label: "Booked" },
  { key: "quiet", label: "Quiet ~20h" },
  { key: "notReady", label: "Not ready" },
  { key: "askedTwice", label: "Asked twice" },
  { key: "notFit", label: "Not a fit" },
] as const;
export type ReleaseKey = (typeof RELEASE_RULES)[number]["key"];

export const CONDITION_RULES: { kind: StepData<"condition">["rule"]["kind"]; label: string; needsValue: boolean }[] = [
  { kind: "follows", label: "Follows me", needsValue: false },
  { kind: "tag", label: "Has tag", needsValue: true },
  { kind: "field_set", label: "Field is filled", needsValue: true },
  { kind: "keyword_seen", label: "Used keyword", needsValue: true },
  { kind: "stage", label: "At stage", needsValue: true },
];

export const ACTION_OPS: { op: StepData<"action">["ops"][number]["op"]; label: string }[] = [
  { op: "add_tag", label: "Add tag" },
  { op: "remove_tag", label: "Remove tag" },
  { op: "set_field", label: "Set field" },
  { op: "friday", label: "Follow-up Friday" },
];

/** One port's short label on the node and the arrow. */
export function portLabel(node: GraphNode, port: string): string {
  if (port === "next") return "";
  if (port === "timeout") return "No reply";
  if (port === "yes") return "Yes";
  if (port === "no") return "No";
  if (port.startsWith("exit:")) return EXIT_LABEL[port.slice(5)] ?? port.slice(5);
  if (port.startsWith("branch:")) {
    const id = port.slice(7);
    return (node.data as StepData<"randomizer">).branches?.find((b) => b.id === id)?.label ?? id;
  }
  if (port === "other") return "Other";
  if (port.startsWith("reply:")) {
    const id = port.slice(6);
    for (const b of (node.data as StepData<"message">).bubbles ?? []) if (b.kind === "quick_replies") for (const x of b.options) if (x.id === id) return x.label || "Option";
    return "Option";
  }
  if (port.startsWith("button:")) {
    const id = port.slice(7);
    for (const b of (node.data as StepData<"message">).bubbles ?? []) if (b.kind === "buttons") for (const x of b.buttons) if (x.id === id) return x.label || "Button";
    return "Button";
  }
  return port;
}

export function safePorts(node: GraphNode): string[] {
  try {
    return portsOf(node);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- time
export function formatMinutes(min: number | undefined | null): string {
  if (!min || min <= 0) return "";
  if (min % 1440 === 0) return `${min / 1440}d`;
  if (min % 60 === 0) return `${min / 60}h`;
  if (min > 60) return `${Math.floor(min / 60)}h ${min % 60}m`;
  return `${min}m`;
}

/** "2h", "1d", "90m", "1h 30m" → minutes. Plain numbers are minutes. */
export function parseDuration(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s) || null;
  let total = 0;
  let matched = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*(d|h|m)/g)) {
    matched = true;
    total += Number(m[1]) * (m[2] === "d" ? 1440 : m[2] === "h" ? 60 : 1);
  }
  return matched && total > 0 ? Math.round(total) : null;
}

/** S7: a wait past Instagram's 24h window needs approval (and dies at 7 days). */
export function waitWindowWarning(data: StepData<"wait">): string | null {
  const span = data.mode === "delay" ? data.minutes : data.timeoutMinutes;
  if (!span) return null;
  if (span > 7 * 1440) return "Past 7 days: Instagram won't let this send.";
  if (span > 1440) return "Past Instagram's 24h: needs your approval.";
  return null;
}

// ---------------------------------------------------------------- message
const URL_RE = /\bhttps?:\/\/[^\s]+|\b(?:[a-z0-9-]+\.)+(?:com|me|io|co|app|dev|net|org|ai|ly|link|page)(?:\/[^\s]*)?/gi;

/** A link is always its own bubble: text bubbles with a URL are split. */
export function normalizeBubbles(bubbles: Bubble[]): Bubble[] {
  const out: Bubble[] = [];
  for (const b of bubbles) {
    if (b.kind !== "text") {
      out.push(b);
      continue;
    }
    let last = 0;
    let found = false;
    for (const m of b.text.matchAll(URL_RE)) {
      found = true;
      const before = b.text.slice(last, m.index).trim();
      if (before) out.push({ kind: "text", text: before });
      const raw = m[0].replace(/[.,!?)]+$/, "");
      out.push({ kind: "link", url: raw.startsWith("http") ? raw : `https://${raw}` });
      last = (m.index ?? 0) + raw.length;
    }
    if (!found) {
      out.push(b);
      continue;
    }
    const after = b.text.slice(last).trim();
    if (after && !/^[.,!?;:)\s]*$/.test(after)) out.push({ kind: "text", text: after });
  }
  return out.length ? out : [{ kind: "text", text: "" }];
}

export function addBubble(bubbles: Bubble[], kind: Bubble["kind"]): Bubble[] {
  const b: Bubble =
    kind === "text"
      ? { kind: "text", text: "" }
      : kind === "link"
        ? { kind: "link" }
        : kind === "buttons"
          ? { kind: "buttons", text: "", buttons: [{ id: buttonId(bubbles), label: "Yes please" }] }
          : kind === "quick_replies"
            ? { kind: "quick_replies", text: "", options: [{ id: buttonId(bubbles), label: "" }] }
            : { kind: "image", assetUrl: "" };
  // One buttons or quick-replies bubble per message: Instagram shows it last.
  if ((kind === "buttons" || kind === "quick_replies") && bubbles.some((x) => x.kind === "buttons" || x.kind === "quick_replies")) return bubbles;
  if (kind !== "quick_replies" && bubbles.at(-1)?.kind === "quick_replies") return [...bubbles.slice(0, -1), b, bubbles.at(-1)!];
  return [...bubbles, b];
}

export function updateBubble(bubbles: Bubble[], i: number, b: Bubble): Bubble[] {
  return bubbles.map((x, j) => (j === i ? b : x));
}

export function removeBubble(bubbles: Bubble[], i: number): Bubble[] {
  const next = bubbles.filter((_, j) => j !== i);
  return next.length ? next : [{ kind: "text", text: "" }];
}

export function moveBubble(bubbles: Bubble[], i: number, dir: -1 | 1): Bubble[] {
  const j = i + dir;
  if (j < 0 || j >= bubbles.length) return bubbles;
  const next = [...bubbles];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function buttonId(bubbles: Bubble[]): string {
  const taken = new Set(bubbles.flatMap((b) => (b.kind === "buttons" ? b.buttons.map((x) => x.id) : b.kind === "quick_replies" ? b.options.map((x) => x.id) : [])));
  for (let i = 1; ; i++) if (!taken.has(`b${i}`)) return `b${i}`;
}

/** IG allows up to 3 buttons, 20 characters each. */
export function addButton(bubbles: Bubble[], i: number): Bubble[] {
  const b = bubbles[i];
  if (!b || b.kind !== "buttons" || b.buttons.length >= 3) return bubbles;
  return updateBubble(bubbles, i, { ...b, buttons: [...b.buttons, { id: buttonId(bubbles), label: "" }] });
}

export function removeButton(bubbles: Bubble[], i: number, id: string): Bubble[] {
  const b = bubbles[i];
  if (!b || b.kind !== "buttons") return bubbles;
  const buttons = b.buttons.filter((x) => x.id !== id);
  return buttons.length ? updateBubble(bubbles, i, { ...b, buttons }) : removeBubble(bubbles, i);
}

export function setButtonLabel(bubbles: Bubble[], i: number, id: string, label: string): Bubble[] {
  const b = bubbles[i];
  if (!b || b.kind !== "buttons") return bubbles;
  return updateBubble(bubbles, i, { ...b, buttons: b.buttons.map((x) => (x.id === id ? { ...x, label: label.slice(0, 20) } : x)) });
}

/** Quick replies: up to 13 options, 20 characters each. */
export const MAX_OPTIONS = 13;

export function addOption(bubbles: Bubble[], i: number): Bubble[] {
  const b = bubbles[i];
  if (!b || b.kind !== "quick_replies" || b.options.length >= MAX_OPTIONS) return bubbles;
  return updateBubble(bubbles, i, { ...b, options: [...b.options, { id: buttonId(bubbles), label: "" }] });
}

export function removeOption(bubbles: Bubble[], i: number, id: string): Bubble[] {
  const b = bubbles[i];
  if (!b || b.kind !== "quick_replies") return bubbles;
  const options = b.options.filter((x) => x.id !== id);
  return options.length ? updateBubble(bubbles, i, { ...b, options }) : removeBubble(bubbles, i);
}

export function setOptionLabel(bubbles: Bubble[], i: number, id: string, label: string): Bubble[] {
  const b = bubbles[i];
  if (!b || b.kind !== "quick_replies") return bubbles;
  return updateBubble(bubbles, i, { ...b, options: b.options.map((x) => (x.id === id ? { ...x, label: label.slice(0, 20) } : x)) });
}

/** {first_name} and friends, for the phone preview. */
export function fillVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (all, k: string) => vars[k] ?? all);
}

// ---------------------------------------------------------------- randomizer
type Branch = StepData<"randomizer">["branches"][number];

/** Set one branch's %; the others share the rest in their old proportions. Sums to 100. */
export function setWeight(branches: Branch[], id: string, weight: number): Branch[] {
  const n = branches.length;
  const w = Math.min(100 - (n - 1), Math.max(1, Math.round(weight)));
  const others = branches.filter((b) => b.id !== id);
  const rest = 100 - w;
  const sum = others.reduce((s, b) => s + b.weight, 0) || others.length;
  let given = 0;
  const shares = new Map<string, number>();
  others.forEach((b, i) => {
    const share = i === others.length - 1 ? rest - given : Math.max(1, Math.round((rest * (sum ? b.weight : 1)) / sum));
    shares.set(b.id, Math.max(1, share));
    given += Math.max(1, share);
  });
  return branches.map((b) => (b.id === id ? { ...b, weight: w } : { ...b, weight: shares.get(b.id) ?? b.weight }));
}

export function addBranch(branches: Branch[]): Branch[] {
  if (branches.length >= 4) return branches;
  const ids = new Set(branches.map((b) => b.id));
  const letter = "ABCD".split("").find((l) => !ids.has(l.toLowerCase()))!;
  const even = Math.floor(100 / (branches.length + 1));
  const next = [...branches.map((b) => ({ ...b, weight: even })), { id: letter.toLowerCase(), label: letter, weight: even }];
  next[0].weight += 100 - even * next.length;
  return next;
}

export function removeBranch(branches: Branch[], id: string): Branch[] {
  if (branches.length <= 2) return branches;
  const left = branches.filter((b) => b.id !== id);
  const sum = left.reduce((s, b) => s + b.weight, 0);
  const scaled = left.map((b) => ({ ...b, weight: Math.max(1, Math.round((b.weight * 100) / sum)) }));
  scaled[0].weight += 100 - scaled.reduce((s, b) => s + b.weight, 0);
  return scaled;
}

/** Per-branch numbers for the A vs B table. */
export interface BranchCounts {
  reached: number;
  replied: number;
  leadMagnet: number;
  booked: number;
  showed: number;
}

export const FUNNEL_ROWS: { key: keyof BranchCounts; label: string }[] = [
  { key: "reached", label: "Reached" },
  { key: "replied", label: "Replied" },
  { key: "leadMagnet", label: "Lead magnet" },
  { key: "booked", label: "Booked" },
  { key: "showed", label: "Showed" },
];

export interface AbCell {
  n: number;
  /** % of the row above, "" for Reached. */
  pct: string;
  /** Bar width vs the biggest Reached, 0..100. */
  bar: number;
}

export interface AbResults {
  branches: { id: string; label: string }[];
  rows: { key: keyof BranchCounts; label: string; cells: AbCell[] }[];
  verdict: LineVerdict;
  /** Ahead on the deciding metric (even while too early), or null. */
  leaderId: string | null;
  /** "Too early" or "A books 2×" style one-liner. */
  note: string;
  people: number;
}

export function abResults(data: StepData<"randomizer">, counts: Record<string, BranchCounts | undefined>): AbResults {
  const zero: BranchCounts = { reached: 0, replied: 0, leadMagnet: 0, booked: 0, showed: 0 };
  const arms = data.branches.map((b) => ({ b, c: counts[b.id] ?? zero }));
  const max = Math.max(1, ...arms.map((a) => a.c.reached));
  const rows = FUNNEL_ROWS.map((r, ri) => ({
    key: r.key,
    label: r.label,
    cells: arms.map(({ c }) => {
      const prev = ri === 0 ? 0 : c[FUNNEL_ROWS[ri - 1].key];
      return { n: c[r.key], pct: ri === 0 ? "" : prev > 0 ? pct(c[r.key] / prev) : "–", bar: Math.round((c[r.key] / max) * 100) };
    }),
  }));
  const verdict = lineVerdict(arms.map(({ b, c }) => ({ id: b.id, label: b.label, reached: c.reached, replied: c.replied, booked: c.booked })));
  const metric: "replied" | "booked" = verdict.kind === "leader" || verdict.kind === "tie" ? verdict.metric : "replied";
  const rated = arms.map(({ b, c }) => ({ b, r: c.reached ? c[metric] / c.reached : 0 })).sort((x, y) => y.r - x.r);
  const leaderId = verdict.kind === "leader" ? verdict.leaderId : rated.length > 1 && rated[0].r > rated[1].r ? rated[0].b.id : null;
  const people = arms.reduce((s, a) => s + a.c.reached, 0);
  let note = "No one yet";
  if (people > 0) {
    if (verdict.kind === "too_early") note = "Too early";
    else if (verdict.kind === "tie") note = "Even so far";
    else if (verdict.kind === "leader") {
      const lead = rated[0];
      const second = rated[1];
      const verb = metric === "booked" ? "books" : "gets replies";
      const times = second && second.r > 0 ? lead.r / second.r : 0;
      note = times >= 1.5 ? `${lead.b.label} ${verb} ${times.toFixed(1).replace(/\.0$/, "")}×` : `${lead.b.label} ahead`;
    }
  }
  return { branches: data.branches.map((b) => ({ id: b.id, label: b.label })), rows, verdict, leaderId, note, people };
}

export { LINE_MIN_REACHED };

// ---------------------------------------------------------------- action
type Op = StepData<"action">["ops"][number];

export function addOp(ops: Op[], op: Op["op"] = "add_tag"): Op[] {
  return [...ops, op === "friday" ? { op } : op === "set_field" ? { op, key: "", value: "" } : { op, key: "" }];
}

export function updateOp(ops: Op[], i: number, patch: Partial<Op>): Op[] {
  return ops.map((o, j) => {
    if (j !== i) return o;
    const next = { ...o, ...patch };
    if (next.op === "friday") return { op: "friday" };
    if (next.op !== "set_field") return { op: next.op, key: next.key ?? "" };
    return { op: next.op, key: next.key ?? "", value: next.value ?? "" };
  });
}

export function removeOp(ops: Op[], i: number): Op[] {
  const next = ops.filter((_, j) => j !== i);
  return next.length ? next : [{ op: "add_tag", key: "" }];
}

// ---------------------------------------------------------------- setter
export function setterSummary(d: StepData<"setter">): string {
  const goal = d.goal === "book_call" ? "Book a call" : "Start a conversation";
  const lm = d.leadMagnet.mode === "hold" ? "Hold" : d.leadMagnet.mode === "send_first" ? "Send first" : null;
  return lm ? `${goal} · ${lm}` : goal;
}

export function toggleRelease(d: StepData<"setter">, key: ReleaseKey): StepData<"setter"> {
  return { ...d, release: { ...d.release, [key]: !d.release[key] } };
}

export function toggleIn(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

/** Fields a step saves to: Ask one, Setter its list, Action its set_field keys. */
export function savesTo(node: GraphNode): string[] {
  switch (node.type) {
    case "ask":
      return (node.data as StepData<"ask">).saveTo ? [(node.data as StepData<"ask">).saveTo] : [];
    case "message":
      return ((node.data as StepData<"message">).bubbles ?? []).flatMap((b) => (b.kind === "quick_replies" && b.saveTo ? [b.saveTo] : []));
    case "setter":
      return (node.data as StepData<"setter">).saveTo ?? [];
    case "action":
      return ((node.data as StepData<"action">).ops ?? []).filter((o) => o.op === "set_field" && o.key).map((o) => o.key!);
    case "wait":
      return (node.data as StepData<"wait">).mode === "until_field" && (node.data as StepData<"wait">).fieldKey ? [(node.data as StepData<"wait">).fieldKey!] : [];
    default:
      return [];
  }
}

// ---------------------------------------------------------------- trigger
/** "SETTER, setter ,  Script" → ["SETTER", "SCRIPT"] (upper, unique). */
export function parseKeywords(raw: string): string[] {
  const out: string[] = [];
  for (const k of raw.split(/[,\n]/)) {
    const w = k.trim().toUpperCase();
    if (w && !out.includes(w)) out.push(w);
  }
  return out;
}

export const TRIGGER_KIND_LABEL: Record<StepData<"trigger">["kind"], string> = { comment: "Comment", story_reply: "Story reply", dm: "DM" };

// ---------------------------------------------------------------- problems
const FRIENDLY: [RegExp, string][] = [
  [/keywords/i, "Add a keyword"],
  [/workflowId/i, "Pick a workflow"],
  [/expected array to have >=1 items|too small/i, "Something is missing"],
];

/** validateGraph's problems, plus the gaps it can't name, in Kevin's words. */
export function friendlyProblems(graph: WorkflowGraph): GraphProblem[] {
  const out: GraphProblem[] = [];
  const seen = new Set<string>();
  const add = (p: GraphProblem) => {
    const k = `${p.nodeId ?? ""}|${p.message}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(p);
    }
  };
  for (const n of graph.nodes) {
    if (n.type === "trigger" && !((n.data as StepData<"trigger">).keywords ?? []).length) add({ nodeId: n.id, message: "Add a keyword" });
    if (n.type === "goto" && !(n.data as StepData<"goto">).workflowId) add({ nodeId: n.id, message: "Pick a workflow" });
    if (n.type === "message") {
      const bubbles = (n.data as StepData<"message">).bubbles ?? [];
      if (bubbles.some((b) => b.kind === "text" && !b.text.trim())) add({ nodeId: n.id, message: "Empty bubble" });
      if (bubbles.some((b) => b.kind === "link" && !b.url && !b.resourceSlug)) add({ nodeId: n.id, message: "Pick a link" });
      if (bubbles.some((b) => b.kind === "buttons" && b.buttons.some((x) => !x.label.trim()))) add({ nodeId: n.id, message: "Name every button" });
      if (bubbles.some((b) => b.kind === "quick_replies" && b.options.some((x) => !x.label.trim()))) add({ nodeId: n.id, message: "Name every option" });
      if (bubbles.some((b) => b.kind === "quick_replies" && !b.text.trim())) add({ nodeId: n.id, message: "Write the question" });
    }
    if (n.type === "ask" && !(n.data as StepData<"ask">).question?.trim()) add({ nodeId: n.id, message: "Write the question" });
    if (n.type === "action" && ((n.data as StepData<"action">).ops ?? []).some((o) => o.op !== "friday" && !o.key)) add({ nodeId: n.id, message: "Pick a tag or field" });
  }
  const trigger = graph.nodes.find((n) => n.type === "trigger");
  if (trigger && !graph.edges.some((e) => e.from === trigger.id)) add({ nodeId: trigger.id, message: "Connect the trigger" });
  for (const p of validateGraph(graph)) {
    let message = p.message;
    if (p.nodeId) {
      const node = graph.nodes.find((n) => n.id === p.nodeId);
      if (node?.type === "trigger" && /keyword|items|small/i.test(message) && out.some((o) => o.nodeId === node.id)) continue;
      if (node?.type === "goto" && out.some((o) => o.nodeId === node.id)) continue;
    }
    for (const [re, text] of FRIENDLY) if (re.test(message) && /^(Too small|Invalid|Expected)/i.test(message)) message = text;
    add({ ...p, message });
  }
  return out;
}

/** Problems grouped per step for the red marks on the canvas. */
export function problemsByNode(problems: GraphProblem[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const p of problems) if (p.nodeId) (out[p.nodeId] ??= []).push(p.message);
  return out;
}

// ---------------------------------------------------------------- line tests
/**
 * Setter step › Tests: "All of J" shows the setter-wide tests, "This
 * workflow" only the tests scoped to this workflow (slot …:workflow:<id>).
 */
export function scopeLineRows<R extends { tests: { scope: "setter" | "all" | "workflow"; workflowId: string | null }[] }>(
  rows: R[],
  scope: "setter" | "workflow",
  workflowId: string
): R[] {
  return rows.map((r) => ({
    ...r,
    tests: r.tests.filter((t) => (scope === "workflow" ? t.scope === "workflow" && t.workflowId === workflowId : t.scope !== "workflow")),
  }));
}
