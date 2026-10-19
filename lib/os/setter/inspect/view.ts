// "J's brain": the Inspect drawer's data, built from a DraftTrace (J with
// tools) or from what a legacy draft kept. Pure and JSON-safe, so the server
// builds it for a draft and the sandbox builds it in the browser.

import { costOf } from "@/lib/os/setter/inspect/prices";
import { estimateTokens, splitSystemPrompt, type DraftTrace, type PromptSection, type ToolKind } from "@/lib/os/setter/agent/trace";

export interface InspectGroup {
  name: string;
  tokens: number;
  text: string;
}

export interface InspectCall {
  n: number;
  name: string;
  kind: ToolKind;
  /** Short argument summary: "(Thu–Sat, Europe/London)". */
  args: string;
  summary: string;
  ok: boolean;
  ms: number | null;
  input: unknown;
  output?: unknown;
}

export interface InspectAction {
  name: string;
  label: string;
  status: "queued" | "rejected" | "dropped" | "dry";
  reason?: string;
}

export interface InspectLine {
  /** "permission_ask" */
  key: string;
  /** "A", "B"… when known. */
  variant: string | null;
  text: string;
}

export interface InspectContext {
  workflow: string | null;
  step: string | null;
  goal: string | null;
  /** "Starter · held", "send first", "none". */
  hold: string | null;
  lines: InspectLine[];
  window: string | null;
  stage: string | null;
}

export interface InspectView {
  /** When J wrote it (ISO). */
  at: string;
  source: "draft" | "sandbox";
  /** No trace: drafted by the one-call J (before tools) or with the flag off. */
  legacy: boolean;
  context: InspectContext;
  prompt: { groups: InspectGroup[]; tokens: number } | null;
  tools: { name: string; kind: ToolKind; used: boolean }[] | null;
  calls: InspectCall[] | null;
  result: {
    bubbles: string[];
    hold: boolean;
    reasoning: string | null;
    actions: InspectAction[];
    linesUsed: string[];
    model: string | null;
    backend: string | null;
    tokensIn: number | null;
    cached: number | null;
    tokensOut: number | null;
    cost: number | null;
    ms: number | null;
  };
  notes: string[];
  /** The raw trace (Copy as JSON). */
  raw: unknown;
}

// ---------------------------------------------------------------- formatting
/** 220 · 9.7k · 123k */
export function fmtTokens(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1000) return String(Math.round(n));
  if (n < 100_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

/** $0.014 · <$0.001 · $1.20 · — */
export function fmtCost(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return "—";
  if (usd === 0) return "$0";
  if (usd < 0.001) return "<$0.001";
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** 18 ms · 3.2s */
export function fmtMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** claude-sonnet-5 → sonnet 5 */
export function shortModel(model: string | null | undefined): string | null {
  if (!model) return null;
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(model);
  return m ? `${m[1]} ${m[2]}${m[3] && m[3].length < 3 ? `.${m[3]}` : ""}` : model;
}

// ---------------------------------------------------------------- prompt groups
export const GROUP_ORDER = ["Method", "System prompt", "Business", "Offers", "Objections", "Examples", "Funnel", "Resources", "Fields", "Other", "Turn", "Thread"] as const;

const BUSINESS = ["offer", "outcome they buy", "price", "mechanism", "what it is not", "guarantee", "icp", "who we do not serve", "proof you may reference", "backstory", "booking link"];

/** Which Inspect group a system prompt section (splitSystemPrompt) belongs to. */
export function groupOf(section: string): (typeof GROUP_ORDER)[number] {
  const s = section.toLowerCase().trim();
  if (s === "method") return "Method";
  if (s === "brand" || s.startsWith("who you are") || s.startsWith("voice") || s.startsWith("allowed emojis")) {
    return s.startsWith("voice examples") ? "Examples" : "System prompt";
  }
  if (s.startsWith("offers")) return "Offers";
  if (s.startsWith("objection")) return "Objections";
  if (s.startsWith("client journey")) return "Funnel";
  if (s.startsWith("resources") || s.startsWith("best episodes")) return "Resources";
  if (s.startsWith("fields")) return "Fields";
  if (BUSINESS.some((b) => s.startsWith(b))) return "Business";
  return "Other";
}

const THREAD_MARK = "The WHOLE conversation so far";

/** The system prompt by group, then the user prompt as Turn + Thread. */
export function groupPrompt(system: PromptSection[], user: string): InspectGroup[] {
  const by = new Map<string, string[]>();
  const add = (g: string, t: string) => {
    if (!t.trim()) return;
    by.set(g, [...(by.get(g) ?? []), t]);
  };
  for (const s of system) add(groupOf(s.name), s.text);
  const cut = user.indexOf(THREAD_MARK);
  if (cut === -1) add("Turn", user);
  else {
    add("Turn", user.slice(0, cut));
    add("Thread", user.slice(cut));
  }
  return GROUP_ORDER.filter((g) => by.has(g)).map((g) => {
    const text = by.get(g)!.join("\n").trim();
    return { name: g, tokens: estimateTokens(text), text };
  });
}

// ---------------------------------------------------------------- context
/** "window: free until 2026-10-19 23:12 UTC" in the user prompt → "free · 14h left". */
export function windowFrom(user: string, at: string): string | null {
  const m = /window: ([a-z_]+)(?: until (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) UTC)?/.exec(user);
  if (!m) return null;
  const [, state, until] = m;
  if (!until) return state;
  const left = (Date.parse(`${until.replace(" ", "T")}:00Z`) - Date.parse(at)) / 3_600_000;
  if (!Number.isFinite(left)) return state;
  return left > 0 ? `${state} · ${Math.max(1, Math.round(left))}h left` : state;
}

/** "Current state: qualify." in the user prompt. */
export function stateFrom(user: string): string | null {
  return /Current state: ([a-z_]+)/.exec(user)?.[1] ?? null;
}

const GOALS: Record<string, string> = { book_call: "Book a call", start_conversation: "Start a conversation" };
const MAGNET: Record<string, string> = { hold: "held", send_first: "send first", none: "none" };

interface StepLike {
  goal?: unknown;
  leadMagnet?: { mode?: unknown; resources?: { slug?: string; title?: string; released?: boolean }[] };
}

/** Goal + hold, read from get_step's answer (when J called it). */
export function stepContext(step: StepLike | null | undefined): { goal: string | null; hold: string | null } {
  if (!step || typeof step !== "object") return { goal: null, hold: null };
  const goal = typeof step.goal === "string" ? (GOALS[step.goal] ?? step.goal) : null;
  const mode = typeof step.leadMagnet?.mode === "string" ? step.leadMagnet.mode : null;
  if (!mode) return { goal, hold: null };
  const r = step.leadMagnet?.resources?.[0];
  const label = mode === "hold" && r?.released ? "released" : (MAGNET[mode] ?? mode);
  return { goal, hold: r && mode !== "none" ? `${r.title || r.slug} · ${label}` : label };
}

// ---------------------------------------------------------------- calls / actions
const clip = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Short, readable arguments for one call. */
export function argsOf(name: string, input: unknown): string {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof i[k] === "string" ? (i[k] as string) : "");
  switch (name) {
    case "reply": {
      const n = Array.isArray(i.bubbles) ? i.bubbles.length : 0;
      return n ? `(${n} bubble${n === 1 ? "" : "s"})` : "(hold)";
    }
    case "check_calendar": {
      const range = [str("from"), str("to")].filter(Boolean).join("–");
      const bits = [range, str("tz")].filter(Boolean);
      return bits.length ? `(${bits.join(", ")})` : "";
    }
    case "book_call":
      return `(${clip([str("slot").slice(0, 16).replace("T", " "), str("email")].filter(Boolean).join(", "))})`;
    case "set_field":
      return `(${clip(`${str("key")} = ${str("value")}`)})`;
    default: {
      const vals = Object.values(i).filter((v) => typeof v === "string" || typeof v === "number") as (string | number)[];
      return vals.length ? `(${clip(vals.join(", "))})` : "";
    }
  }
}

const RESOURCE_NAME = (slug: string) => slug.replace(/^episode-/, "").replace(/[-_]+/g, " ");

/** "Book Thu 14:00", "Send setter starter", "niche = coaching". */
export function actionLabel(name: string, input: unknown): string {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof i[k] === "string" ? (i[k] as string) : "");
  switch (name) {
    case "book_call":
      return `Book ${s("slot").slice(0, 16).replace("T", " ") || "call"}`;
    case "send_resource":
      return `Send ${RESOURCE_NAME(s("slug"))}`;
    case "set_field":
      return clip(`${s("key")} = ${s("value")}`);
    case "add_tag":
      return `+ ${s("tag")}`;
    case "remove_tag":
      return `− ${s("tag")}`;
    case "set_stage":
      return `Stage ${s("stage")}`;
    case "exit_step":
      return `Exit ${s("exit")}`;
    case "hand_to_kevin":
      return "Hand to Kevin";
    default:
      return name;
  }
}

// ---------------------------------------------------------------- build
export interface ViewExtras {
  source?: "draft" | "sandbox";
  /** Variant labels ("A", "B") by variant id. */
  variantLabels?: Record<string, string>;
  stage?: string | null;
  workflow?: string | null;
  step?: string | null;
  /** Goal / lead magnet the sandbox forced (shown when J didn't call get_step). */
  stepOverride?: StepLike | null;
}

export function viewFromTrace(t: DraftTrace, x: ViewExtras = {}): InspectView {
  const stepCall = [...t.calls].reverse().find((c) => c.name === "get_step" && c.ok);
  const sc = stepContext((stepCall?.output as StepLike) ?? x.stepOverride ?? null);
  const used = new Set(t.calls.map((c) => c.name));
  const u = t.usage;
  const tokensIn = u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
  return {
    at: t.startedAt,
    source: x.source ?? (t.dry ? "sandbox" : "draft"),
    legacy: false,
    context: {
      workflow: x.workflow ?? null,
      step: x.step ?? null,
      goal: sc.goal,
      hold: sc.hold,
      lines: t.lines.assigned.map((l) => ({ key: l.label, variant: x.variantLabels?.[l.variantId] ?? null, text: l.text })),
      window: windowFrom(t.prompt.user, t.startedAt),
      stage: x.stage ?? stateFrom(t.prompt.user),
    },
    prompt: { groups: groupPrompt(t.prompt.system, t.prompt.user), tokens: t.prompt.systemTokens + t.prompt.userTokens },
    tools: t.tools.map((tool) => ({ name: tool.name, kind: tool.kind, used: used.has(tool.name) })),
    calls: t.calls.map((c) => ({
      n: c.n,
      name: c.name,
      kind: c.kind,
      args: argsOf(c.name, c.input),
      summary: c.summary,
      ok: c.ok,
      ms: c.kind === "read" || c.kind === "reply" ? c.ms : null,
      input: c.input,
      ...(c.output !== undefined ? { output: c.output } : {}),
    })),
    result: {
      bubbles: t.reply?.bubbles ?? [],
      hold: t.reply?.hold ?? true,
      reasoning: t.reply?.reasoning ?? null,
      actions: t.actions.map((a) => ({
        name: a.name,
        label: actionLabel(a.name, a.input),
        status: t.dry && a.status === "queued" ? "dry" : a.status,
        ...(a.reason ? { reason: a.reason } : {}),
      })),
      linesUsed: t.lines.used,
      model: t.model || null,
      backend: t.backend || null,
      tokensIn: u.requests ? tokensIn : null,
      cached: u.requests ? u.cacheReadTokens : null,
      tokensOut: u.requests ? u.outputTokens : null,
      cost: costOf(t.model, u),
      ms: t.ms,
    },
    notes: [...(t.forcedReply ? ["tool limit hit: reply forced"] : []), ...t.notes],
    raw: t,
  };
}

export interface LegacyInput {
  at: string;
  source?: "draft" | "sandbox";
  bubbles: string[];
  hold?: boolean;
  reasoning: string | null;
  stage: string | null;
  backend: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens?: number | null;
  /** The prompt, when it was kept (the sandbox keeps it). */
  prompt?: { system: string; user: string } | null;
  raw?: unknown;
}

/** A draft with no trace: whatever it kept. */
export function viewFromLegacy(l: LegacyInput): InspectView {
  const prompt = l.prompt ? { groups: groupPrompt(splitSystemPrompt(l.prompt.system), l.prompt.user), tokens: estimateTokens(l.prompt.system) + estimateTokens(l.prompt.user) } : null;
  const read = l.cacheReadTokens ?? 0;
  const known = l.inputTokens != null && l.outputTokens != null;
  return {
    at: l.at,
    source: l.source ?? "draft",
    legacy: true,
    context: {
      workflow: null,
      step: null,
      goal: null,
      hold: null,
      lines: [],
      window: l.prompt ? windowFrom(l.prompt.user, l.at) : null,
      stage: l.stage,
    },
    prompt,
    tools: null,
    calls: null,
    result: {
      bubbles: l.bubbles,
      hold: l.hold ?? !l.bubbles.length,
      reasoning: l.reasoning,
      actions: [],
      linesUsed: [],
      model: l.model,
      backend: l.backend,
      tokensIn: known ? l.inputTokens! + read : null,
      cached: known ? read : null,
      tokensOut: known ? l.outputTokens : null,
      cost: known ? costOf(l.model, { inputTokens: l.inputTokens!, outputTokens: l.outputTokens!, cacheReadTokens: read }) : null,
      ms: null,
    },
    notes: [],
    raw: l.raw ?? null,
  };
}
