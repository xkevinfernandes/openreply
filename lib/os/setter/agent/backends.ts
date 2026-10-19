// Who answers J's tool-loop requests: the Anthropic API (tool use), or a fake
// that plays scripted tool calls (tests, OS_MOCK click-throughs). The loop
// (loop.ts) is the same for both.

import type Anthropic from "@anthropic-ai/sdk";
import type { DrafterBackend, DrafterSettings } from "@/lib/os/setter/config";
import { anthropicClient, apiError, draft as runDrafter, DraftError, effortFor, resolveModel } from "@/lib/os/setter/drafter";
import { bubblesOf, type DraftObject } from "@/lib/os/setter/prompt";

export interface ModelRequest {
  system: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  settings: DrafterSettings;
  /** 1-based model request number in this turn. */
  turn: number;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ModelResponse {
  /** Appended to the conversation as the assistant turn, unchanged. */
  content: Anthropic.ContentBlockParam[];
  stopReason: string | null;
  usage: ModelUsage;
  model: string;
}

export interface AgentBackend {
  name: DrafterBackend;
  step(req: ModelRequest): Promise<ModelResponse>;
}

// ---------------------------------------------------------------- Anthropic
export const anthropicBackend: AgentBackend = {
  name: "anthropic_api",
  async step({ system, messages, tools, settings }) {
    const model = resolveModel(settings.models.draft, "draft");
    let resp: Anthropic.Message;
    try {
      resp = await anthropicClient(settings).messages.create({
        model,
        max_tokens: Number(settings.max_tokens.draft ?? 4000),
        // tools + system are the same for every turn of this setter: cache
        // them; the top-level breakpoint caches the growing loop as well.
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        cache_control: { type: "ephemeral" },
        tools,
        tool_choice: { type: "auto" },
        messages,
        ...effortFor(settings, "draft", model),
      });
    } catch (err) {
      throw apiError(err);
    }
    if (resp.stop_reason === "refusal") throw new DraftError("model refused the request");
    return {
      content: resp.content as unknown as Anthropic.ContentBlockParam[],
      stopReason: resp.stop_reason,
      model,
      usage: {
        inputTokens: resp.usage.input_tokens,
        outputTokens: resp.usage.output_tokens,
        cacheReadTokens: resp.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: resp.usage.cache_creation_input_tokens ?? 0,
      },
    };
  },
};

// ---------------------------------------------------------------- fake
/** What a scripted step sees: the tool results so far, oldest first. */
export interface FakeView {
  prompt: string;
  turn: number;
  results: { name: string; input: unknown; ok: boolean; output: unknown }[];
  /** The tools offered on this request (only `reply` once the cap is hit). */
  tools: string[];
}

export interface FakeCall {
  name: string;
  input?: Record<string, unknown>;
}

/** One model request's worth of tool calls, fixed or computed from what came back. */
export type FakeStep = FakeCall[] | ((view: FakeView) => FakeCall[]);

const ZERO: ModelUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

function userText(m: Anthropic.MessageParam): string {
  return typeof m.content === "string" ? m.content : m.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

/** The tool results in the conversation so far, matched to their calls. */
function viewOf(req: ModelRequest): FakeView {
  const calls = new Map<string, { name: string; input: unknown }>();
  const results: FakeView["results"] = [];
  for (const m of req.messages) {
    if (typeof m.content === "string") continue;
    for (const b of m.content) {
      if (b.type === "tool_use") calls.set(b.id, { name: b.name, input: b.input });
      if (b.type === "tool_result") {
        const c = calls.get(b.tool_use_id);
        const text = typeof b.content === "string" ? b.content : (b.content ?? []).map((x) => (x.type === "text" ? x.text : "")).join("");
        let output: unknown = text;
        try {
          output = JSON.parse(text);
        } catch {
          // plain text result
        }
        if (c) results.push({ name: c.name, input: c.input, ok: !b.is_error, output });
      }
    }
  }
  return { prompt: userText(req.messages[0]), turn: req.turn, results, tools: req.tools.map((t) => t.name) };
}

let fakeIds = 0;
function toolUse(c: FakeCall): Anthropic.ToolUseBlockParam {
  return { type: "tool_use", id: `toolu_fake_${++fakeIds}`, name: c.name, input: c.input ?? {} };
}

/** Plays `steps` in order, one per model request. When the script runs out,
 *  it replies with what it has (a hold). */
export function scriptedBackend(steps: FakeStep[]): AgentBackend {
  return {
    name: "fake",
    async step(req) {
      const step = steps[req.turn - 1];
      const calls = step ? (typeof step === "function" ? step(viewOf(req)) : step) : [{ name: "reply", input: { bubbles: [], lines_used: [], reasoning: "fake: script ended", hold_reason: "script ended" } }];
      return { content: calls.map(toolUse), stopReason: "tool_use", usage: ZERO, model: "fake" };
    },
  };
}

const STAGE_WORDS = new Set(["opener", "value", "permission", "qualify", "bridge", "booked"]);

/** No script: the legacy fake's canned JSON for this prompt, played as tool
 *  calls (set_stage + reply), so OS_MOCK click-throughs read the same. */
export const fakeBackend: AgentBackend = {
  name: "fake",
  async step(req) {
    if (req.turn > 1) return scriptedBackend([]).step({ ...req, turn: 99 });
    const { obj } = await runDrafter({ system: req.system, prompt: userText(req.messages[0]), settings: req.settings, backend: "fake" });
    const o = (obj && typeof obj === "object" ? obj : {}) as DraftObject;
    const calls: FakeCall[] = [];
    const stage = String(o.stage_proposed ?? "");
    if (STAGE_WORDS.has(stage)) calls.push({ name: "set_stage", input: { stage } });
    const bubbles = o.hold ? [] : bubblesOf(o);
    calls.push({
      name: "reply",
      input: {
        bubbles,
        lines_used: Array.isArray(o.ab_lines_used) ? o.ab_lines_used : [],
        reasoning: o.stage_reasoning ?? "fake backend",
        ...(o.hold_reason ? { hold_reason: o.hold_reason } : {}),
        ...(o.invite && typeof o.invite === "object" ? { invite: o.invite } : {}),
      },
    });
    return { content: calls.map(toolUse), stopReason: "tool_use", usage: ZERO, model: "fake" };
  },
};

export function backendFor(name: DrafterBackend): AgentBackend | null {
  if (name === "anthropic_api") return anthropicBackend;
  if (name === "fake") return fakeBackend;
  return null; // claude_cli has no tool use: the legacy path runs instead
}
