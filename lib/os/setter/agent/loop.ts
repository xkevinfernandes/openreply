// One J turn as a tool loop (Anthropic tool use). Read tools run straight
// away; actions are checked and queued (never executed here); `reply` ends
// the turn. After MAX_TOOL_CALLS calls only `reply` is offered. The result is
// the legacy draft object (actions.ts mapTurn) plus the DraftTrace.

import type Anthropic from "@anthropic-ai/sdk";
import type { DraftUsage } from "@/lib/os/setter/drafter";
import { DraftError, extractJson } from "@/lib/os/setter/drafter";
import type { DrafterSettings } from "@/lib/os/setter/config";
import { checkAction, hasUrl, mapTurn, readReply, stripUrls, type MappedTurn, type QueuedAction, type ReplyInput } from "@/lib/os/setter/agent/actions";
import type { AgentBackend } from "@/lib/os/setter/agent/backends";
import {
  bookingContextFrom,
  checkCalendar,
  getContact,
  getResource,
  getStep,
  newTurnState,
  searchKnowledge,
  usableCalendar,
  type AgentEnv,
  type ReadResult,
} from "@/lib/os/setter/agent/context";
import { MAX_TOOL_CALLS, toolDef, toolKind, toolsFor, type ActionTool, type ToolName } from "@/lib/os/setter/agent/tools";
import { emptyUsage, estimateTokens, splitSystemPrompt, TRACE_VERSION, type DraftTrace, type TraceAction, type TraceCall } from "@/lib/os/setter/agent/trace";
import type { BookingContext } from "@/lib/os/setter/booking";
import { bubblesOf, type DraftObject } from "@/lib/os/setter/prompt";

/** Model requests per turn, whatever happens (cap + a nudge + the forced reply). */
const MAX_REQUESTS = MAX_TOOL_CALLS + 3;

export interface AgentTurn extends MappedTurn {
  /** What check_calendar saw, for applyBookingReply (null = no times looked at). */
  bookingCtx: BookingContext | null;
  usage: DraftUsage;
  trace: DraftTrace;
}

export interface AgentTurnInput {
  system: string;
  prompt: string;
  env: AgentEnv;
  backend: AgentBackend;
  settings: DrafterSettings;
}

const json = (v: unknown) => JSON.stringify(v);

export async function runAgentTurn({ system, prompt, env, backend, settings }: AgentTurnInput): Promise<AgentTurn> {
  const t0 = Date.now();
  const state = newTurnState();
  const offered = toolsFor({
    calendar: Boolean(usableCalendar(env.calendar)),
    fields: Boolean(env.setter.profile.fields?.length),
    resources: true,
  });
  const allTools = offered.map(toolDef);
  const replyOnly = [toolDef("reply")];

  const usage = emptyUsage();
  let model = "";
  const calls: TraceCall[] = [];
  const queued: QueuedAction[] = [];
  const rejected: TraceAction[] = [];
  const done = new Set<string>();
  const notes: string[] = [];
  let reply: ReplyInput | null = null;
  let replyRejections = 0;
  let forced = false;
  let nudged = false;
  let counted = 0; // tool calls that count toward the cap (reply doesn't)

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];

  for (let turn = 1; turn <= MAX_REQUESTS && !reply; turn++) {
    const capped = counted >= MAX_TOOL_CALLS || turn === MAX_REQUESTS;
    if (capped) forced = forced || counted >= MAX_TOOL_CALLS;
    const res = await backend.step({ system, messages, tools: capped ? replyOnly : allTools, settings, turn });
    model = res.model;
    usage.requests++;
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;
    usage.cacheReadTokens += res.usage.cacheReadTokens;
    usage.cacheWriteTokens += res.usage.cacheWriteTokens;
    messages.push({ role: "assistant", content: res.content });

    const uses = res.content.filter((b): b is Anthropic.ToolUseBlockParam => b.type === "tool_use");
    if (!uses.length) {
      // No tool call: a JSON answer in text is accepted as the reply (old habit).
      const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      const asJson = tryJson(text);
      if (asJson) {
        reply = fromLegacy(asJson);
        notes.push("reply came as JSON text, not the reply tool");
        break;
      }
      if (nudged || capped) {
        notes.push("no reply tool call: held");
        break;
      }
      nudged = true;
      messages.push({ role: "user", content: "Finish the turn by calling the reply tool (bubbles: [] to hold)." });
      continue;
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const u of uses) {
      const name = u.name as ToolName;
      const input = (u.input && typeof u.input === "object" ? u.input : {}) as Record<string, unknown>;
      const started = Date.now();
      const kind = toolKind(name);
      const n = calls.length + 1;
      const record = (ok: boolean, summary: string, output?: unknown) => calls.push({ n, name, kind, input, summary, ok, ms: Date.now() - started, ...(output !== undefined ? { output } : {}) });
      const answer = (content: string, isError = false) => results.push({ type: "tool_result", tool_use_id: u.id, content, ...(isError ? { is_error: true } : {}) });

      if (reply) {
        answer("The turn already ended with reply.", true);
        continue;
      }
      if (kind === "reply") {
        const r = readReply(input);
        const urlIdx = r.bubbles.findIndex(hasUrl);
        if (urlIdx !== -1 && replyRejections === 0 && !capped) {
          replyRejections++;
          const why = "Links never go in bubbles. Remove the link and use send_resource (or book_call) instead, then call reply again.";
          record(false, why);
          answer(why, true);
          continue;
        }
        if (urlIdx !== -1) {
          r.bubbles = r.bubbles.map(stripUrls).filter(Boolean);
          notes.push("links stripped from the reply");
        }
        const known = new Set(env.lines.map((l) => l.label));
        const unknown = r.linesUsed.filter((l) => !known.has(l));
        if (unknown.length) notes.push(`lines_used not assigned, ignored: ${unknown.join(", ")}`);
        r.linesUsed = r.linesUsed.filter((l) => known.has(l));
        reply = r;
        record(true, r.bubbles.length ? `${r.bubbles.length} bubble${r.bubbles.length === 1 ? "" : "s"}` : "hold");
        answer("ok");
        continue;
      }
      const overCap = capped || counted >= MAX_TOOL_CALLS;
      if (overCap) forced = true;
      if (!offered.includes(name) || overCap) {
        const why = overCap ? `Tool limit reached (${MAX_TOOL_CALLS}). Call reply now.` : `No tool "${u.name}" this turn.`;
        record(false, why);
        answer(why, true);
        continue;
      }
      counted++;
      if (kind === "read") {
        let out: ReadResult;
        try {
          out = await runRead(name, env, state, input);
        } catch (err) {
          out = { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
        if (out.ok) {
          record(true, out.summary, out.output);
          answer(json(out.output));
        } else {
          record(false, out.error);
          answer(out.error, true);
        }
      } else {
        const check = checkAction(env, state, name as ActionTool, input, done);
        if (check.ok) {
          done.add(check.key);
          queued.push({ name: name as ActionTool, input });
          record(true, env.dry ? "recorded (sandbox)" : "queued");
          answer(env.dry ? "Recorded (sandbox: nothing is executed)." : "Queued: it goes out with your reply once approved.");
        } else {
          rejected.push({ name, input, status: "rejected", reason: check.reason });
          record(false, check.reason);
          answer(check.reason, true);
        }
      }
    }
    if (reply) break;
    const content: Anthropic.ContentBlockParam[] = [...results];
    if (counted >= MAX_TOOL_CALLS) content.push({ type: "text", text: `You've used ${MAX_TOOL_CALLS} tool calls. Call reply now with what you have.` });
    messages.push({ role: "user", content });
  }

  const mapped = mapTurn(env, state, queued, rejected, reply);
  const sys = splitSystemPrompt(system);
  const trace: DraftTrace = {
    version: TRACE_VERSION,
    mode: "tools",
    dry: env.dry,
    startedAt: new Date(t0).toISOString(),
    ms: Date.now() - t0,
    backend: backend.name,
    model,
    usage,
    prompt: { system: sys, systemTokens: sys.reduce((n, x) => n + x.tokens, 0), user: prompt, userTokens: estimateTokens(prompt) },
    tools: offered.map((name) => ({ name, kind: toolKind(name) })),
    calls,
    lines: { assigned: env.lines, used: reply?.linesUsed ?? [] },
    actions: mapped.actions,
    reply: reply ? { bubbles: [...bubblesOf(mapped.obj), ...mapped.resourceBubbles], reasoning: reply.reasoning, hold: Boolean(mapped.obj.hold) } : null,
    forcedReply: forced,
    notes: [...notes, ...mapped.notes],
  };
  if (!model) throw new DraftError("J's tool loop made no model request");
  return {
    ...mapped,
    bookingCtx: bookingContextFrom(env, state),
    usage: {
      backend: backend.name,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
    },
    trace,
  };
}

function runRead(name: ToolName, env: AgentEnv, state: ReturnType<typeof newTurnState>, input: Record<string, unknown>): Promise<ReadResult> {
  switch (name) {
    case "get_contact":
      return getContact(env);
    case "get_step":
      return getStep(env);
    case "check_calendar":
      return checkCalendar(env, state, input);
    case "get_resource":
      return getResource(env, input);
    case "search_knowledge":
      return searchKnowledge(env, input);
    default:
      return Promise.resolve({ ok: false, error: `No tool "${name}".` });
  }
}

function tryJson(text: string): DraftObject | null {
  if (!text.trim()) return null;
  try {
    const v = extractJson(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as DraftObject) : null;
  } catch {
    return null;
  }
}

/** A legacy JSON answer read as a reply (bubbles, ab_lines_used, reasoning). */
function fromLegacy(o: DraftObject): ReplyInput {
  return readReply({
    bubbles: (o.hold ? [] : bubblesOf(o)).map((b) => (hasUrl(b) ? stripUrls(b) : b)).filter(Boolean),
    lines_used: o.ab_lines_used,
    reasoning: o.stage_reasoning ?? o.reasoning,
    hold_reason: o.hold_reason,
  });
}
