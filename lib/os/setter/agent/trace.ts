// DraftTrace: everything J saw and did in one tool-using turn. Saved on the
// draft as Draft.raw.trace (and returned by the sandbox), so the Inspect panel
// ("J's brain", stream B1) can show it without re-running anything.
//
// Pure: types plus the small helpers that build the prompt part. Client
// components may import the types.

/** Bump when the shape changes in a way the Inspect panel must branch on. */
export const TRACE_VERSION = 1 as const;

/** One named part of a prompt, with a rough token count (chars / 4). */
export interface PromptSection {
  /** "method", "brand", "Offer", "VOICE EXAMPLES", "RESOURCES"… */
  name: string;
  text: string;
  chars: number;
  /** Rough estimate (chars / 4), not the tokenizer. Good for spotting the heavy parts. */
  tokens: number;
}

/** A tool J could call this turn. */
export interface TraceTool {
  name: string;
  /** read = runs now and answers; action = queued with the draft; reply = ends the turn. */
  kind: ToolKind;
}

export type ToolKind = "read" | "action" | "reply";

/** One tool call, in the order J made it. */
export interface TraceCall {
  /** 1-based position in the turn. */
  n: number;
  name: string;
  kind: ToolKind;
  input: unknown;
  /** Short human summary of what came back ("6 free times", "queued", the error). */
  summary: string;
  /** The full answer J got (JSON-able). Absent for actions/reply. */
  output?: unknown;
  /** False when the server refused it (validation) or the read failed. */
  ok: boolean;
  ms: number;
}

/** One A/B line this contact is assigned (only that variant ever reaches J). */
export interface TraceLine {
  /** The experiment slot, e.g. "line:permission_ask". */
  slot: string;
  variantId: string;
  /** What J reports back in lines_used: "opener", "permission_ask"… */
  label: string;
  text: string;
  /** When the line's moment comes ("you invite them to the call"). */
  when?: string;
}

/** A queued action and what the server made of it. */
export interface TraceAction {
  name: string;
  input: unknown;
  /**
   * queued   = goes out with the draft (Approve / Auto runs it)
   * rejected = broke a rule when J called it (J was told why)
   * dropped  = accepted, then dropped at the end (paused contact, closed window)
   */
  status: "queued" | "rejected" | "dropped";
  reason?: string;
}

export interface TraceUsage {
  /** Model requests in this turn (1 for a plain reply). */
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface DraftTrace {
  version: typeof TRACE_VERSION;
  mode: "tools";
  /** Sandbox: actions were only recorded, never queued on a real draft. */
  dry: boolean;
  startedAt: string;
  /** Wall clock for the whole turn, model + tools. */
  ms: number;
  backend: string;
  model: string;
  usage: TraceUsage;
  prompt: {
    /** The system prompt by section, in order. Joined, they are the system prompt. */
    system: PromptSection[];
    systemTokens: number;
    /** The user prompt exactly as sent. */
    user: string;
    userTokens: number;
  };
  /** The tools offered this turn (they differ: no book_call without a calendar). */
  tools: TraceTool[];
  calls: TraceCall[];
  lines: { assigned: TraceLine[]; used: string[] };
  actions: TraceAction[];
  /** J's final reply, after the server's checks. Null when the turn had no reply. */
  reply: { bubbles: string[]; reasoning: string | null; hold: boolean } | null;
  /** The 8-call cap was hit and J had to reply. */
  forcedReply: boolean;
  /** Anything the server noticed that isn't an action ("url stripped from bubble 2"). */
  notes: string[];
}

/** Rough token estimate used across the trace. */
export function estimateTokens(text: string): number {
  return Math.ceil((text ?? "").length / 4);
}

function sec(name: string, text: string): PromptSection {
  return { name, text, chars: text.length, tokens: estimateTokens(text) };
}

/**
 * The system prompt (method + "---" + BRAND CONTEXT, lib/os/setter/prompt.ts)
 * split into named sections: the method, the brand header, then one section
 * per "### heading" (Offer, VOICE EXAMPLES, RESOURCES…). Lossless: the texts
 * joined back are the prompt.
 */
export function splitSystemPrompt(system: string): PromptSection[] {
  const cut = system.indexOf("\n\n---\n\n");
  const method = cut === -1 ? system : system.slice(0, cut);
  const brand = cut === -1 ? "" : system.slice(cut);
  const out: PromptSection[] = [sec("method", method)];
  if (!brand) return out;
  const parts = brand.split(/\n(?=### )/);
  out.push(sec("brand", parts[0]));
  for (const p of parts.slice(1)) {
    const name = /^### (.+)$/m.exec(p)?.[1]?.trim() ?? "section";
    out.push(sec(name.replace(/\s*\(.*\)\s*$/, "") || name, "\n" + p));
  }
  return out;
}

export function emptyUsage(): TraceUsage {
  return { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

/** Narrow unknown (Draft.raw.trace) to a DraftTrace. */
export function isDraftTrace(v: unknown): v is DraftTrace {
  return Boolean(v && typeof v === "object" && (v as DraftTrace).mode === "tools" && Array.isArray((v as DraftTrace).calls));
}
