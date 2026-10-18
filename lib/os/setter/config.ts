import { loadSetterConfigFile } from "@/lib/os/setter/knowledge";
import { DEFAULT_TIMERS, FREEZE_TAGS, type Timers } from "@/lib/os/setter/state";

export type Autonomy = "approve" | "auto";
export type DrafterBackend = "anthropic_api" | "claude_cli" | "fake";

export interface DrafterSettings {
  backend: DrafterBackend;
  models: Record<string, string>;
  effort: Record<string, string>;
  max_tokens: Record<string, number>;
  timeout_seconds: number;
}

export interface SetterConfig {
  /** approve = every send is approved in the Inbox. `auto` is reserved: no
   *  code path sends without approval (spec item 9). */
  autonomy: Autonomy;
  client: string;
  timers: Timers;
  debounce_seconds: number;
  drafter: DrafterSettings;
  skip_tags: string[];
}

const DRAFTER_DEFAULTS: Omit<DrafterSettings, "backend"> = {
  models: { draft: "claude-sonnet-5", triage: "claude-haiku-4-5" },
  effort: { draft: "medium", triage: "low" },
  max_tokens: { draft: 4000, triage: 2000 },
  timeout_seconds: 300,
};

/**
 * Which model writes the drafts. OS_DRAFTER wins when set. Otherwise: the
 * Anthropic API when a key is set; the local `claude` CLI (Kevin's
 * subscription) in development; and the canned fake in production without a
 * key, so a deploy never silently shells out. OS_MOCK_DRAFTER=fake forces the
 * fake under OS_MOCK=1 (tests, click-throughs without a model).
 */
export function resolveBackend(env: NodeJS.ProcessEnv = process.env): DrafterBackend {
  const forced = env.OS_DRAFTER;
  if (forced === "anthropic_api" || forced === "claude_cli" || forced === "fake") return forced;
  if (env.OS_MOCK === "1" && env.OS_MOCK_DRAFTER === "fake") return "fake";
  if (env.VITEST) return "fake";
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return "anthropic_api";
  if (env.NODE_ENV !== "production") return "claude_cli";
  return "fake";
}

function merge<T extends Record<string, unknown>>(base: T, over: unknown): T {
  return { ...base, ...((over && typeof over === "object" ? over : {}) as Partial<T>) };
}

export function getSetterConfig(): SetterConfig {
  const file = loadSetterConfigFile();
  const d = (file.drafter ?? {}) as Record<string, unknown>;
  return {
    autonomy: file.autonomy === "auto" ? "auto" : "approve",
    client: typeof file.client === "string" ? file.client : "claudepreneur",
    timers: merge(DEFAULT_TIMERS, file.timers),
    debounce_seconds: typeof file.debounce_seconds === "number" ? file.debounce_seconds : 45,
    drafter: {
      backend: resolveBackend(),
      models: merge(DRAFTER_DEFAULTS.models, d.models),
      effort: merge(DRAFTER_DEFAULTS.effort, d.effort),
      max_tokens: merge(DRAFTER_DEFAULTS.max_tokens, d.max_tokens),
      timeout_seconds: typeof d.timeout_seconds === "number" ? d.timeout_seconds : DRAFTER_DEFAULTS.timeout_seconds,
    },
    skip_tags: Array.isArray(file.skip_tags) ? (file.skip_tags as string[]) : FREEZE_TAGS,
  };
}
