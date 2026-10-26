import { describe, expect, it, vi } from "vitest";
import { KIT_CONNECTED, KIT_DISCONNECT_CONFIRM, KIT_REFUSED, KIT_REPLACED, KIT_UNREACHABLE, kitKeyRequest } from "../../lib/os/integrations/kit-connect";

const answer = (status: number, body: unknown) => vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));

describe("Kit connect (mocked /api/crm/kit, no live Kit)", () => {
  it("a refused key says so", async () => {
    const f = answer(502, { success: false, error: "The Kit API key is invalid." });
    expect(await kitKeyRequest(f, "POST", { apiKey: "bad-key-123" })).toEqual({ ok: false, error: KIT_REFUSED });
    expect(f).toHaveBeenCalledWith("/api/crm/kit", expect.objectContaining({ method: "POST", body: JSON.stringify({ apiKey: "bad-key-123" }) }));
  });

  it("a network failure says try again", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await kitKeyRequest(f, "POST", { apiKey: "k".repeat(20) })).toEqual({ ok: false, error: KIT_UNREACHABLE });
    expect(await kitKeyRequest(answer(502, { success: false, error: "Kit didn't respond. Please retry." }), "POST", { apiKey: "k".repeat(20) })).toEqual({ ok: false, error: KIT_UNREACHABLE });
  });

  it("success: connected, nothing synced yet", async () => {
    expect(await kitKeyRequest(answer(200, { success: true }), "POST", { apiKey: "k".repeat(20) })).toEqual({ ok: true, notice: KIT_CONNECTED });
    expect(KIT_CONNECTED).toBe("Connected · nothing synced yet");
  });

  it("replace: a refused key keeps the old one (only the error comes back)", async () => {
    expect(await kitKeyRequest(answer(502, { success: false, error: "The Kit API key is invalid." }), "POST", { apiKey: "new-bad-key", replacing: true })).toEqual({ ok: false, error: KIT_REFUSED });
    expect(await kitKeyRequest(answer(200, { success: true }), "POST", { apiKey: "new-good-key", replacing: true })).toEqual({ ok: true, notice: KIT_REPLACED });
  });

  it("disconnect sends DELETE with no key, after the confirm", async () => {
    const f = answer(200, { success: true });
    expect((await kitKeyRequest(f, "DELETE")).ok).toBe(true);
    expect(f).toHaveBeenCalledWith("/api/crm/kit", expect.not.objectContaining({ body: expect.anything() }));
    expect(KIT_DISCONNECT_CONFIRM).toBe("Disconnect Kit? Nothing more syncs. Your field mapping is kept.");
  });
});
