// Image -> one short line J can read. Adapter (plan default 2):
//   anthropic   Claude Haiku vision on ANTHROPIC_API_KEY
//   openrouter  Gemini Flash on OPENROUTER_API_KEY
//   fake        a canned line (tests, OS_MOCK, dev without keys)
// Production with no key: none, the image stays "[photo]".

import { MediaProviderError, openRouterAsk, toBase64, type MediaBytes } from "@/lib/os/media/transcribe";

type Env = Record<string, string | undefined>;

export interface Describer {
  name: "anthropic" | "openrouter" | "fake";
  describe(image: MediaBytes): Promise<string>;
}

export const FAKE_DESCRIPTION = "(sample) a screenshot of a phone screen";
export const DEFAULT_VISION_MODEL = "claude-haiku-4-5";
/** Anthropic's base64 image limit. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const DESCRIBE_INSTRUCTION =
  "Someone sent this image in an Instagram DM to Kevin, who coaches creators on AI and automation. " +
  "Describe it in one plain line under 25 words, as context for his reply. If it is a screenshot, say what it shows and quote the key text " +
  "(a calendar invite or booking confirmation: say so, with the date and time). No preamble.";

export function describerName(env: Env = process.env): Describer["name"] | null {
  const forced = env.OS_MEDIA_BACKEND?.trim().toLowerCase();
  const prod = env.NODE_ENV === "production";
  if (forced === "fake") return prod ? null : "fake";
  if (forced === "anthropic" || forced === "openrouter") return forced;
  if (env.VITEST || env.OS_MOCK === "1") return "fake";
  if (env.ANTHROPIC_API_KEY?.trim()) return "anthropic";
  if (env.OPENROUTER_API_KEY?.trim()) return "openrouter";
  return prod ? null : "fake";
}

/** image/jpeg | png | gif | webp, sniffed from the bytes when the header lies. */
export function imageType(img: MediaBytes): string {
  const b = img.bytes;
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57) return "image/webp";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  const t = (img.contentType ?? "").toLowerCase();
  return ["image/png", "image/gif", "image/webp"].find((x) => t.includes(x)) ?? "image/jpeg";
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export function createDescriber(name: Describer["name"], opts: { env?: Env; fetch?: typeof fetch } = {}): Describer {
  const env = opts.env ?? process.env;
  const send = opts.fetch ?? fetch;
  if (name === "fake") return { name, describe: async () => FAKE_DESCRIPTION };
  const guard = (img: MediaBytes) => {
    if (img.bytes.length > MAX_IMAGE_BYTES) throw new MediaProviderError("image is over 5 MB");
  };
  if (name === "openrouter") {
    return {
      name,
      async describe(img) {
        guard(img);
        const url = `data:${imageType(img)};base64,${toBase64(img.bytes)}`;
        return oneLine(await openRouterAsk({ type: "image_url", image_url: { url } }, DESCRIBE_INSTRUCTION, env, send));
      },
    };
  }
  return {
    name,
    async describe(img) {
      guard(img);
      const key = env.ANTHROPIC_API_KEY?.trim();
      if (!key) throw new MediaProviderError("ANTHROPIC_API_KEY is not set");
      const res = await send("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({
          model: env.OS_VISION_MODEL?.trim() || DEFAULT_VISION_MODEL,
          max_tokens: 200,
          messages: [
            {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: imageType(img), data: toBase64(img.bytes) } },
                { type: "text", text: DESCRIBE_INSTRUCTION },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        const body = (await res.text().catch(() => "")).slice(0, 200);
        throw new MediaProviderError(`anthropic ${res.status}: ${body}`, res.status);
      }
      const json = (await res.json()) as { content?: { type: string; text?: string }[] };
      const text = oneLine((json.content ?? []).map((c) => (c.type === "text" ? c.text ?? "" : "")).join(""));
      if (!text) throw new MediaProviderError("anthropic returned no text");
      return text;
    },
  };
}

export function resolveDescriber(opts: { env?: Env; fetch?: typeof fetch } = {}): Describer | null {
  const name = describerName(opts.env ?? process.env);
  return name ? createDescriber(name, opts) : null;
}
