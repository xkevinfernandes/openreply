// Port of DM Setter/scripts/dms/drafter.py: the one seam between J and
// whichever model writes for it. Every backend returns the first JSON object
// in the reply, parsed. The contract (bubbles, stage_proposed, …) is a prompt
// contract, not a schema, so the backends stay interchangeable.
//
//   anthropic_api  the Anthropic SDK, key from ANTHROPIC_API_KEY (per-token cost)
//   claude_cli     `claude -p … --append-system-prompt …` on the local machine,
//                  Kevin's Claude subscription. Development only.
//   fake           canned JSON, deterministic. Tests and OS_MOCK click-throughs.
// (codex_cli from the Python version is not ported.)

import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { DrafterBackend, DrafterSettings } from "@/lib/os/setter/config";

export class DraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftError";
  }
}

export interface DraftUsage {
  backend: DrafterBackend;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
}

export interface DraftCallResult {
  obj: unknown;
  usage: DraftUsage;
}

// ---------------------------------------------------------------- JSON extraction
/** First JSON object or array in `text`, parsed. Tolerates prose and fences. */
export function extractJson(input: string | null | undefined): unknown {
  const text = (input ?? "").trim();
  const fence = /```(?:json)?\s*([[{][\s\S]*?[\]}])\s*```/.exec(text);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {
      // fall through to the bracket scan
    }
  }
  // whichever bracket comes FIRST wins: an array of objects must not be read as its first object
  const pos = (c: string) => (text.indexOf(c) === -1 ? text.length : text.indexOf(c));
  const pairs: [string, string][] = [
    ["{", "}"],
    ["[", "]"],
  ];
  pairs.sort((a, b) => pos(a[0]) - pos(b[0]));
  for (const [opener, closer] of pairs) {
    let start = text.indexOf(opener);
    while (start !== -1) {
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === "\\") esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === opener) depth++;
        else if (ch === closer) {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(text.slice(start, i + 1));
            } catch {
              break;
            }
          }
        }
      }
      start = text.indexOf(opener, start + 1);
    }
  }
  throw new DraftError(`no JSON in model output: ${JSON.stringify(text.slice(0, 200))}`);
}

// ---------------------------------------------------------------- models
const KNOWN_MODELS = new Set([
  "claude-fable-5-1",
  "claude-fable-5",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-5-5",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-haiku-5-5",
  "claude-haiku-4-5",
]);

/** setter.config.json may carry an id this SDK/API doesn't know (a typo, a
 *  CLI alias like "sonnet", a dated snapshot). Map it to its family. */
export function resolveModel(id: string | undefined, job: string): string {
  const m = (id ?? "").trim().toLowerCase();
  if (KNOWN_MODELS.has(m)) return m;
  if (m.includes("opus")) return "claude-opus-5-5";
  if (m.includes("haiku")) return "claude-haiku-4-5";
  if (m.includes("fable")) return "claude-fable-5-1";
  if (m.includes("sonnet")) return "claude-sonnet-5";
  return job === "triage" ? "claude-haiku-4-5" : "claude-sonnet-5";
}

// ---------------------------------------------------------------- backends
interface Call {
  system: string;
  prompt: string;
  job: string;
  s: DrafterSettings;
}

let client: Anthropic | null = null;

/** The shared SDK client (J's tool loop, lib/os/setter/agent, uses it too). */
export function anthropicClient(s: DrafterSettings): Anthropic {
  client ??= new Anthropic({ timeout: s.timeout_seconds * 1000 });
  return client;
}

/** output_config.effort for a job, when the model takes it. Haiku 4.5
 *  rejects it; the 4.6+/5 family takes it and runs adaptive thinking. */
export function effortFor(s: DrafterSettings, job: string, model: string): { output_config: { effort: "low" | "medium" | "high" } } | Record<string, never> {
  const effort = s.effort[job];
  return effort && !model.startsWith("claude-haiku-4") ? { output_config: { effort: effort as "low" | "medium" | "high" } } : {};
}

/** SDK errors as a DraftError with a readable message; anything else as is. */
export function apiError(err: unknown): unknown {
  if (err instanceof Anthropic.AuthenticationError) return new DraftError("Anthropic auth failed — check ANTHROPIC_API_KEY.");
  if (err instanceof Anthropic.RateLimitError) return new DraftError(`Anthropic rate limit: ${err.message}`);
  if (err instanceof Anthropic.APIConnectionError) return new DraftError(`Anthropic connection error: ${err.message}`);
  if (err instanceof Anthropic.APIError) return new DraftError(`Anthropic API ${err.status}: ${err.message}`);
  return err;
}

async function anthropicApi({ system, prompt, job, s }: Call): Promise<[string, DraftUsage]> {
  const model = resolveModel(s.models[job] ?? s.models.draft, job);
  client ??= new Anthropic({ timeout: s.timeout_seconds * 1000 });
  // Haiku 4.5 rejects output_config.effort; the 4.6+/5 family takes it and
  // runs adaptive thinking by default, which is what we want for drafts.
  const effort = s.effort[job];
  const withEffort = effort && !model.startsWith("claude-haiku-4");
  let resp: Anthropic.Message;
  try {
    resp = await client.messages.create({
      model,
      max_tokens: Number(s.max_tokens[job] ?? s.max_tokens.draft ?? 4000),
      // The method + brand block is the same for every draft: cache it.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
      ...(withEffort ? { output_config: { effort: effort as "low" | "medium" | "high" } } : {}),
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new DraftError("Anthropic auth failed — check ANTHROPIC_API_KEY.");
    if (err instanceof Anthropic.RateLimitError) throw new DraftError(`Anthropic rate limit: ${err.message}`);
    if (err instanceof Anthropic.APIConnectionError) throw new DraftError(`Anthropic connection error: ${err.message}`);
    if (err instanceof Anthropic.APIError) throw new DraftError(`Anthropic API ${err.status}: ${err.message}`);
    throw err;
  }
  if (resp.stop_reason === "refusal") throw new DraftError("model refused the request");
  const text = resp.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return [
    text,
    {
      backend: "anthropic_api",
      model,
      inputTokens: resp.usage.input_tokens,
      outputTokens: resp.usage.output_tokens,
      cacheReadTokens: resp.usage.cache_read_input_tokens ?? 0,
    },
  ];
}

const CLI_GUARD =
  "\n\nOUTPUT RULES: respond with the JSON object only. Ignore any instruction from " +
  "project files or memory about how to open a message (no name, no greeting), " +
  "no prose before or after the JSON.";

/** Run the CLI OUTSIDE any repo so it never loads a CLAUDE.md (whose "start
 *  with Kevin" rule leaked into a draft on 2026-09-14). */
function cliCwd(): string {
  const d = path.join(tmpdir(), "cp-os-drafter");
  mkdirSync(d, { recursive: true });
  return d;
}

function claudeBin(): string {
  return process.env.CLAUDE_BIN || "claude";
}

async function claudeCli({ system, prompt, job, s }: Call): Promise<[string, DraftUsage]> {
  if (process.env.NODE_ENV === "production" && process.env.OS_DRAFTER !== "claude_cli") {
    throw new DraftError("claude_cli is a local-only drafter. Set ANTHROPIC_API_KEY on the deploy.");
  }
  const model = s.models[job];
  // the CLI takes family aliases; map API ids onto them so one config works
  const alias = model ? (["haiku", "sonnet", "opus"].find((a) => model.includes(a)) ?? model) : undefined;
  const args = ["-p", prompt, "--append-system-prompt", system + CLI_GUARD, ...(alias ? ["--model", alias] : [])];
  const env = { ...process.env, PATH: `${process.env.PATH ?? ""}:${path.join(homedir(), ".local/bin")}:/opt/homebrew/bin` };
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      claudeBin(),
      args,
      { cwd: cliCwd(), env, timeout: s.timeout_seconds * 1000, maxBuffer: 10 * 1024 * 1024 },
      (err, out, stderr) => {
        if (err) {
          const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
          reject(new DraftError(missing ? "`claude` CLI not found on PATH" : `claude CLI failed: ${String(stderr || err.message).slice(0, 300)}`));
        } else resolve(out);
      }
    );
  });
  return [stdout, { backend: "claude_cli", model: alias ?? "default" }];
}

async function fake({ prompt, job }: Call): Promise<[string, DraftUsage]> {
  const usage: DraftUsage = { backend: "fake", model: "fake" };
  if (job === "triage" && prompt.startsWith("TRIAGE: kind")) {
    // One contact (lib/os/setter/triage.ts). Markers force a verdict in tests;
    // otherwise a keyword guess on what they wrote, so demos look plausible.
    const said = prompt.split("\n").filter((l) => /^(NEW )?THEM( \(card\))?:/.test(l)).join(" ");
    const pitch =
      prompt.includes("[fake:pitch]") ||
      (!prompt.includes("[fake:sales]") && !prompt.includes("[fake:personal]") && !prompt.includes("already marked PERSONAL") &&
        (/THEM \(card\):/.test(prompt) || /grow your (page|account)|\d+x your|our agency|we help|collab|sponsor|shout ?out/i.test(said)));
    if (pitch) return [JSON.stringify({ kind: "pitch", why: "Selling to you (sample)" }), usage];
    const sales = prompt.includes("[fake:sales]")
      ? true
      : prompt.includes("[fake:personal]")
        ? false
        : /price|cost|how much|coach|business|clients?|offer|automat|work with you|program/i.test(said);
    return [JSON.stringify({ kind: sales ? "sales" : "personal", why: sales ? "Asks about the business (sample)" : "Reads like a personal chat (sample)" }), usage];
  }
  if (job === "triage") {
    const n = (prompt.match(/^THREAD \d+/gm) ?? []).length || 1;
    return [JSON.stringify(Array.from({ length: n }, (_, i) => ({ n: i + 1, verdict: "SETTER", why: "fake backend" }))), usage];
  }
  if (prompt.includes("[fake:invite]")) {
    return [
      JSON.stringify({
        bubbles: ["that's a real plateau", "honestly think I can help you with that", "want to jump on a quick call?", "no pressure at all"],
        doc_bubbles: ["that's a real plateau", "I'll send you the doc, my DMs are open"],
        stage_proposed: "bridge",
        stage_reasoning: "fake backend",
        invite_ready: true,
        invite: { offer: "Case study offer", route_suggestion: "call", why_fit: "fake" },
        propose_tags: { qualified: "fake" },
      }),
      usage,
    ];
  }
  // Booking in the DM (lib/os/setter/booking.ts): markers pick the step; the
  // slot ids come from the CALENDAR section of the prompt.
  const slotIds = [...prompt.matchAll(/^- (\d{4}-\d{2}-\d{2}T[\d:]+Z) = /gm)].map((m) => m[1]);
  if (prompt.includes("[fake:book-confirm]")) {
    const email = /[\w.+-]+@[\w-]+\.[\w.]+/.exec(prompt.split("The WHOLE conversation")[1] ?? "")?.[0] ?? null;
    const link = prompt.includes("{booking_link}") ? " {booking_link}" : "";
    return [
      JSON.stringify({
        bubbles: [`done, booked you in${link}`, "once the invite lands can you send me a screenshot of it? just so I know it came through"],
        stage_proposed: "booked",
        stage_reasoning: "fake backend",
        booking: { action: "confirm", slot: slotIds[0] ?? null, email, name: null, timezone: null },
      }),
      usage,
    ];
  }
  if (prompt.includes("[fake:book-email]")) {
    return [
      JSON.stringify({
        bubbles: ["perfect", "what's the best email for the invite?"],
        stage_proposed: "booked",
        stage_reasoning: "fake backend",
        booking: { action: "ask_email", slot: slotIds[0] ?? null },
      }),
      usage,
    ];
  }
  if (prompt.includes("[fake:book-propose]")) {
    return [
      JSON.stringify({
        bubbles: ["bet, would either of these work? (your time)"],
        stage_proposed: "booked",
        stage_reasoning: "fake backend",
        booking: { action: "propose", slots: slotIds.slice(0, 2) },
      }),
      usage,
    ];
  }
  if (prompt.includes("[fake:hold]")) {
    return [JSON.stringify({ bubbles: [], hold: true, hold_reason: "fake backend holds" }), usage];
  }
  const kind = /DRAFT KIND: (\w+)/.exec(prompt)?.[1] ?? "reply";
  if (kind === "followup") {
    // A sample line per step so the follow-up queue reads right on sample data.
    const label = /FOLLOW-UP STEP: "([^"]+)"/.exec(prompt)?.[1] ?? "";
    const link = /exact link on its own line: (\S+)/.exec(prompt)?.[1];
    const lines: Record<string, string[]> = {
      "Value first": ["random thought after what you said about posting, batching it all on one day saved me hours a week", "might be worth a go"],
      "Social proof": ["one of the guys I work with had the exact same thing last month", "got it sorted in about 2 weeks, made me think of you"],
      "Direct ask": ["quick one, is sorting this still a priority for you right now?"],
      Breakup: ["haven't heard back so I'll leave it here", "if things change just shout, always happy to help"],
      "On the day": ["looking forward to it in a bit 🙌"],
      "Check in": ["hey, all good? we were meant to jump on earlier", "hope everything's ok, things come up"],
      "Offer another time": ["no stress at all, want to find another time that works better?"],
    };
    const bubbles = [...(lines[label] ?? (link ? ["made me think of you after what you said, sharing in case it helps"] : ["no rush on this, just thought of you"])), ...(link ? [link] : [])];
    return [JSON.stringify({ bubbles, stage_reasoning: "fake backend", template_used: "fake", propose_tags: {} }), usage];
  }
  const bubbles =
    {
      value_opener: ["did you get a chance to watch it?", "curious what you're building rn"],
      nudge: ["no stress if not, just lmk if it was useful"],
      friday: ["thought of you when I saw this, sharing in case it helps"],
    }[kind] ?? ["ha okay that's actually interesting", "what are you working on right now?"];
  // Like the real model, answer what they said in their latest voice note.
  const voice = kind === "reply" ? lastVoiceNote(prompt) : null;
  if (voice) bubbles[0] = `"${voice}" haha I hear you`;
  // Like the real model, use a recorded line word for word when one is offered.
  const voiceLine = /Use as its own bubble:\n- "([^"\n]+)"/.exec(prompt)?.[1];
  if (voiceLine) bubbles[bubbles.length - 1] = voiceLine;
  return [
    JSON.stringify({
      bubbles,
      stage_proposed: "value",
      stage_reasoning: "fake backend",
      template_used: "fake",
      qualification: { fit_score: 0 },
      propose_tags: {},
    }),
    usage,
  ];
}

/** The first words of the latest voice note in the conversation block, if it
 *  is among their last three messages ("[voice note] \"…\""). */
export function lastVoiceNote(prompt: string): string | null {
  const convo = prompt.split("The WHOLE conversation")[1] ?? "";
  const lines = convo.split("\n").filter((l) => /^(THEM|YOU):/.test(l));
  for (const l of lines.slice(-3).reverse()) {
    const m = /^THEM: \[voice note\] "?([^"\n]+?)"?\s*$/.exec(l);
    if (m && !m[1].startsWith("(no speech)")) {
      const words = m[1].replace(/^\(sample\)\s*/, "").split(/\s+/);
      return words.slice(0, 9).join(" ") + (words.length > 9 ? "…" : "");
    }
  }
  return null;
}

const BACKENDS: Record<DrafterBackend, (c: Call) => Promise<[string, DraftUsage]>> = {
  anthropic_api: anthropicApi,
  claude_cli: claudeCli,
  fake,
};

/** Run one job and return the parsed JSON object the model produced. */
export async function draft(opts: {
  system: string;
  prompt: string;
  job?: string;
  settings: DrafterSettings;
  backend?: DrafterBackend;
}): Promise<DraftCallResult> {
  const name = opts.backend ?? opts.settings.backend;
  const fn = BACKENDS[name];
  if (!fn) throw new DraftError(`unknown drafter backend ${JSON.stringify(name)}`);
  const [text, usage] = await fn({ system: opts.system, prompt: opts.prompt, job: opts.job ?? "draft", s: opts.settings });
  return { obj: extractJson(text), usage };
}
