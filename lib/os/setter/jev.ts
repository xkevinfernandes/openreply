// Jev (TypeSafe's "System One") client: typed decisions with calibrated
// probabilities, no free text either way. Mirrors DataOS scripts/extract/jev.py.
//
// One POST carries a `state` (the thing judged) plus a map of typed
// `questions`; the response is an `answers` map with one typed answer per
// question. A `choice` question answers {choice, confidence, probabilities?};
// a `noul` (independent yes/no) answers {noul: p}. It is NOT the
// OpenAI-compatible chat endpoint, so this speaks HTTP directly.
//
// Env:
//   JEV_PROVIDER        openrouter (default) or typesafe
//   OPENROUTER_API_KEY  for provider openrouter
//   TYPESAFE_API_KEY    for provider typesafe (TypeSafe's API is waitlisted)
//   JEV_MODEL           optional; defaults per provider

export const JEV_PROVIDERS = {
  openrouter: { url: "https://openrouter.ai/api/alpha/decisions", keyEnv: "OPENROUTER_API_KEY", model: "typesafe/jev-1.13" },
  typesafe: { url: "https://api.typesafe.ai/v1/systemone", keyEnv: "TYPESAFE_API_KEY", model: "jev-latest" },
} as const;

export type JevProviderName = keyof typeof JEV_PROVIDERS;

/** Jev caps a choice question at 255 options. */
export const MAX_CHOICE_CARDINALITY = 255;

export class JevError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "JevError";
  }
}

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  /** option key -> rubric. The rubric is the only definition Jev sees. */
  criteria: Record<string, string>;
}

export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria: { true: string; false: string };
}

export type JevQuestion = ChoiceQuestion | NoulQuestion;
export type JevAnswers = Record<string, unknown>;

type Env = Record<string, string | undefined>;

export function jevProvider(env: Env = process.env): { name: JevProviderName; url: string; keyEnv: string; model: string } {
  const raw = (env.JEV_PROVIDER ?? "").trim().toLowerCase();
  // No JEV_PROVIDER: OpenRouter, unless only a TypeSafe key is set.
  const name = raw || (!env.OPENROUTER_API_KEY?.trim() && env.TYPESAFE_API_KEY?.trim() ? "typesafe" : "openrouter");
  if (!(name in JEV_PROVIDERS)) {
    throw new JevError(`Unknown JEV_PROVIDER=${JSON.stringify(name)}; expected: ${Object.keys(JEV_PROVIDERS).join(", ")}`);
  }
  return { name: name as JevProviderName, ...JEV_PROVIDERS[name as JevProviderName] };
}

/** True when the selected provider's key is set (no network call). */
export function jevConfigured(env: Env = process.env): boolean {
  try {
    const p = jevProvider(env);
    return Boolean(env[p.keyEnv]?.trim());
  } catch {
    return false;
  }
}

export function jevModel(env: Env = process.env): string {
  return env.JEV_MODEL?.trim() || jevProvider(env).model;
}

function jevKey(env: Env): string {
  const p = jevProvider(env);
  const key = env[p.keyEnv]?.trim();
  if (!key) throw new JevError(`${p.keyEnv} is not set (OS_TRIAGE=jev needs it)`);
  return key;
}

export interface AskOptions {
  env?: Env;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Attempts on 429 / 5xx / network errors (default 4). */
  maxAttempts?: number;
  /** Backoff sleep, swappable in tests. */
  sleep?: (ms: number) => Promise<void>;
  baseSleepMs?: number;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Send one state + questions and return the `answers` map. */
export async function ask(state: string, questions: Record<string, JevQuestion>, opts: AskOptions = {}): Promise<JevAnswers> {
  const env = opts.env ?? process.env;
  for (const [name, q] of Object.entries(questions)) {
    if (q.type === "choice" && Object.keys(q.criteria).length > MAX_CHOICE_CARDINALITY) {
      throw new JevError(`question ${name} has more than ${MAX_CHOICE_CARDINALITY} options`);
    }
  }
  const url = jevProvider(env).url;
  const key = jevKey(env);
  const payload = { state, model: jevModel(env), questions };
  const send = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? wait;
  const attempts = Math.max(1, opts.maxAttempts ?? 4);
  const base = opts.baseSleepMs ?? 1500;

  let last: JevError | null = null;
  for (let i = 0; i < attempts; i++) {
    if (i) await sleep(base * 2 ** (i - 1));
    let res: Response;
    try {
      res = await send(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": "dm-os/1.0" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      });
    } catch (err) {
      last = new JevError(`jev request failed: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 300);
      last = new JevError(`jev ${res.status}: ${body}`, res.status);
      if (res.status === 429 || res.status >= 500) continue;
      throw last;
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new JevError("jev response was not JSON");
    }
    const answers = (body as { answers?: unknown } | null)?.answers;
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
      throw new JevError(`jev response had no answers map: ${JSON.stringify(body).slice(0, 200)}`);
    }
    return answers as JevAnswers;
  }
  throw last ?? new JevError("jev request failed");
}

const prob = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
};

/** A choice answer as {choice, probability}. The label is the argmax of the
 *  probability vector when Jev sends one (same vector, same label), else
 *  Jev's `choice` with its `confidence`. Null when the answer is unusable or
 *  names an option that was not asked. */
export function readChoice(answer: unknown, options: string[]): { choice: string; probability: number } | null {
  if (!answer || typeof answer !== "object") return null;
  const a = answer as { choice?: unknown; confidence?: unknown; probabilities?: unknown };
  const probs = a.probabilities && typeof a.probabilities === "object" ? (a.probabilities as Record<string, unknown>) : null;
  if (probs) {
    let best: { choice: string; probability: number } | null = null;
    for (const o of options) {
      const p = prob(probs[o]);
      if (p != null && (!best || p > best.probability)) best = { choice: o, probability: p };
    }
    if (best) return best;
  }
  const choice = typeof a.choice === "string" ? a.choice : null;
  if (!choice || !options.includes(choice)) return null;
  return { choice, probability: prob(a.confidence) ?? 0 };
}

/** A noul answer's probability, {type:"noul", noul: 0.98}. Junk is null. */
export function readNoul(answer: unknown): number | null {
  const raw = answer && typeof answer === "object" ? (answer as { noul?: unknown }).noul : answer;
  return prob(raw);
}
