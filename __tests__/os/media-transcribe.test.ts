import { describe, expect, it, vi } from "vitest";
import { createDescriber, describerName, imageType } from "../../lib/os/media/describe";
import { createTranscriber, extOf, FAKE_TRANSCRIPT, resolveTranscriber, transcriberName } from "../../lib/os/media/transcribe";

function fakeFetch(json: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const audio = { bytes: new Uint8Array([1, 2, 3]), contentType: "audio/mp4" };
const png = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), contentType: "application/octet-stream" };

describe("backend selection", () => {
  it("fake under tests, keys pick the real one, production without keys has none", () => {
    expect(transcriberName({ VITEST: "true" })).toBe("fake");
    expect(transcriberName({ OPENAI_API_KEY: "k" })).toBe("openai");
    expect(transcriberName({ OPENROUTER_API_KEY: "k" })).toBe("openrouter");
    expect(transcriberName({ OPENAI_API_KEY: "k", OPENROUTER_API_KEY: "k" })).toBe("openai");
    expect(transcriberName({ NODE_ENV: "production" })).toBeNull();
    expect(transcriberName({ NODE_ENV: "production", OS_MEDIA_BACKEND: "fake" })).toBeNull();
    expect(transcriberName({})).toBe("fake");
    expect(describerName({ ANTHROPIC_API_KEY: "k", OPENROUTER_API_KEY: "k" })).toBe("anthropic");
    expect(describerName({ OPENROUTER_API_KEY: "k" })).toBe("openrouter");
    expect(describerName({ NODE_ENV: "production" })).toBeNull();
    expect(resolveTranscriber({ env: { NODE_ENV: "production" } })).toBeNull();
  });
});

describe("transcribe (fake fetch)", () => {
  it("fake returns the canned line", async () => {
    expect(await createTranscriber("fake").transcribe(audio)).toBe(FAKE_TRANSCRIPT);
  });

  it("openai: multipart to /audio/transcriptions with gpt-4o-mini-transcribe", async () => {
    const f = fakeFetch({ text: " how much is it and where's the link " });
    const t = createTranscriber("openai", { env: { OPENAI_API_KEY: "sk-test" }, fetch: f.fetch });
    expect(await t.transcribe(audio)).toBe("how much is it and where's the link");
    expect(f.calls[0].url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect((f.calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    const form = f.calls[0].init.body as FormData;
    expect(form.get("model")).toBe("gpt-4o-mini-transcribe");
    expect((form.get("file") as File).name).toBe("voice.m4a");
  });

  it("openrouter: Gemini Flash with input_audio", async () => {
    const f = fakeFetch({ choices: [{ message: { content: "hello there" } }] });
    const t = createTranscriber("openrouter", { env: { OPENROUTER_API_KEY: "or-test" }, fetch: f.fetch });
    expect(await t.transcribe(audio)).toBe("hello there");
    const body = JSON.parse(String(f.calls[0].init.body));
    expect(body.model).toBe("google/gemini-2.5-flash");
    expect(body.messages[0].content[1]).toMatchObject({ type: "input_audio", input_audio: { format: "m4a", data: "AQID" } });
  });

  it("surfaces provider errors", async () => {
    const f = fakeFetch({ error: "bad" }, 500);
    await expect(createTranscriber("openai", { env: { OPENAI_API_KEY: "k" }, fetch: f.fetch }).transcribe(audio)).rejects.toThrow(/openai 500/);
    await expect(createTranscriber("openai", { env: {}, fetch: f.fetch }).transcribe(audio)).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it("maps content types to formats", () => {
    expect(extOf("audio/mpeg")).toBe("mp3");
    expect(extOf("audio/ogg; codecs=opus")).toBe("ogg");
    expect(extOf(null)).toBe("m4a");
  });
});

describe("describe (fake fetch)", () => {
  it("anthropic: Haiku vision with a base64 image, one line back", async () => {
    const f = fakeFetch({ content: [{ type: "text", text: "A Google Calendar invite\nfor Tue 3pm" }] });
    const d = createDescriber("anthropic", { env: { ANTHROPIC_API_KEY: "a-test" }, fetch: f.fetch });
    expect(await d.describe(png)).toBe("A Google Calendar invite for Tue 3pm");
    expect(f.calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.parse(String(f.calls[0].init.body));
    expect(body.model).toBe("claude-haiku-4-5");
    expect(body.messages[0].content[0].source).toMatchObject({ type: "base64", media_type: "image/png" });
  });

  it("openrouter: data url image", async () => {
    const f = fakeFetch({ choices: [{ message: { content: "a gym selfie" } }] });
    const d = createDescriber("openrouter", { env: { OPENROUTER_API_KEY: "k" }, fetch: f.fetch });
    expect(await d.describe(png)).toBe("a gym selfie");
    const body = JSON.parse(String(f.calls[0].init.body));
    expect(body.messages[0].content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
  });

  it("sniffs the image type", () => {
    expect(imageType({ bytes: new Uint8Array([0xff, 0xd8, 0xff]), contentType: null })).toBe("image/jpeg");
    expect(imageType(png)).toBe("image/png");
  });
});
