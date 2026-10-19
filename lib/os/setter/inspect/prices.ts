// The one price table for J's turns (USD per million tokens, Anthropic API
// list prices, 2026-10). Cache reads are 0.1× input, cache writes 1.25×.
// Unknown models (the fake backend, the local CLI) have no cost.

export interface ModelPrice {
  input: number;
  output: number;
}

export const PRICES: Record<string, ModelPrice> = {
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

export const CACHE_READ = 0.1;
export const CACHE_WRITE = 1.25;

export interface CostUsage {
  /** Uncached input tokens (Anthropic's input_tokens). */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** The price for a model id, tolerating a date suffix ("claude-sonnet-5-20260101"). */
export function priceFor(model: string | null | undefined): ModelPrice | null {
  if (!model) return null;
  const id = model.replace(/^(anthropic\.|us\.anthropic\.)/, "");
  if (PRICES[id]) return PRICES[id];
  const key = Object.keys(PRICES)
    .sort((a, b) => b.length - a.length)
    .find((k) => id.startsWith(k + "-") || id.startsWith(k + "@"));
  return key ? PRICES[key] : null;
}

/** USD for one turn's usage, or null when the model has no price. */
export function costOf(model: string | null | undefined, u: CostUsage): number | null {
  const p = priceFor(model);
  if (!p) return null;
  const read = u.cacheReadTokens ?? 0;
  const write = u.cacheWriteTokens ?? 0;
  return (u.inputTokens * p.input + read * p.input * CACHE_READ + write * p.input * CACHE_WRITE + u.outputTokens * p.output) / 1_000_000;
}
