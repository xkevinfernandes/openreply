// Voice note -> text. Adapter (plan default 2):
//   openai      gpt-4o-mini-transcribe on OPENAI_API_KEY
//   openrouter  Gemini Flash audio input on OPENROUTER_API_KEY
//   fake        a canned line (tests, OS_MOCK, dev without keys)
// Production with no key has no transcriber at all: a fake line must never
// reach J as something a lead said. Keys are read from env at call time.

type Env = Record<string, string | undefined>;

export interface MediaBytes {
  bytes: Uint8Array;
  contentType: string | null;
}

export interface Transcriber {
  name: "openai" | "openrouter" | "fake";
  transcribe(audio: MediaBytes): Promise<string>;
}

export class MediaProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "MediaProviderError";
  }
}

export const FAKE_TRANSCRIPT = "(sample) quick voice note, honestly the DMs take up most of my morning";
export const DEFAULT_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";
export const DEFAULT_OPENROUTER_MEDIA_MODEL = "google/gemini-2.5-flash";

/** Which backend a key set allows. OS_MEDIA_BACKEND=fake|openai|openrouter forces one. */
export function transcriberName(env: Env = process.env): Transcriber["name"] | null {
  const forced = env.OS_MEDIA_BACKEND?.trim().toLowerCase();
  const prod = env.NODE_ENV === "production";
  if (forced === "fake") return prod ? null : "fake";
  if (forced === "openai" || forced === "openrouter") return forced;
  if (env.VITEST || env.OS_MOCK === "1") return "fake";
  if (env.OPENAI_API_KEY?.trim()) return "openai";
  if (env.OPENROUTER_API_KEY?.trim()) return "openrouter";
  return prod ? null : "fake";
}

export function extOf(contentType: string | null): string {
  const t = (contentType ?? "").toLowerCase();
  if (t.includes("mpeg") || t.includes("mp3")) return "mp3";
  if (t.includes("wav")) return "wav";
  if (t.includes("ogg") || t.includes("opus")) return "ogg";
  if (t.includes("webm")) return "webm";
  if (t.includes("aac")) return "aac";
  return "m4a"; // Instagram voice notes are AAC in an MP4 box
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function failOf(res: Response, who: string): Promise<MediaProviderError> {
  const body = (await res.text().catch(() => "")).slice(0, 200);
  return new MediaProviderError(`${who} ${res.status}: ${body}`, res.status);
}

/** OpenRouter chat call with one media part; returns the text answer. */
export async function openRouterAsk(part: unknown, instruction: string, env: Env, send: typeof fetch): Promise<string> {
  const key = env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new MediaProviderError("OPENROUTER_API_KEY is not set");
  const res = await send("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.OS_MEDIA_OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MEDIA_MODEL,
      messages: [{ role: "user", content: [{ type: "text", text: instruction }, part] }],
      max_tokens: 1000,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw await failOf(res, "openrouter");
  const json = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
  const content = json.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (c as { text?: string }).text ?? "").join("") : "";
  if (!text.trim()) throw new MediaProviderError("openrouter returned no text");
  return text.trim();
}

const TRANSCRIBE_INSTRUCTION =
  "Transcribe this Instagram voice note word for word, in its original language. Reply with the transcript only, no quotes or notes. If nothing is said, reply (no speech).";

export function createTranscriber(name: Transcriber["name"], opts: { env?: Env; fetch?: typeof fetch } = {}): Transcriber {
  const env = opts.env ?? process.env;
  const send = opts.fetch ?? fetch;
  if (name === "fake") return { name, transcribe: async () => FAKE_TRANSCRIPT };
  if (name === "openrouter") {
    return {
      name,
      transcribe: (a) =>
        openRouterAsk({ type: "input_audio", input_audio: { data: toBase64(a.bytes), format: extOf(a.contentType) } }, TRANSCRIBE_INSTRUCTION, env, send),
    };
  }
  return {
    name,
    async transcribe(a) {
      const key = env.OPENAI_API_KEY?.trim();
      if (!key) throw new MediaProviderError("OPENAI_API_KEY is not set");
      const form = new FormData();
      const ext = extOf(a.contentType);
      form.append("file", new Blob([Buffer.from(a.bytes)], { type: a.contentType || "audio/mp4" }), `voice.${ext === "aac" ? "m4a" : ext}`);
      form.append("model", env.OS_TRANSCRIBE_MODEL?.trim() || DEFAULT_TRANSCRIBE_MODEL);
      form.append("response_format", "json");
      const res = await send("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw await failOf(res, "openai");
      const json = (await res.json()) as { text?: string };
      return (json.text ?? "").trim();
    },
  };
}

/** The transcriber the env allows, or null (production without a key). */
export function resolveTranscriber(opts: { env?: Env; fetch?: typeof fetch } = {}): Transcriber | null {
  const name = transcriberName(opts.env ?? process.env);
  return name ? createTranscriber(name, opts) : null;
}
