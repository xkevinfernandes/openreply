import { describe, expect, it, vi } from "vitest";
import { holdDraft, type HoldDeps } from "@/lib/os/inbox";

function deps(discardResult: { error?: string } = {}) {
  const calls: string[] = [];
  const d: HoldDeps = {
    discard: vi.fn(async (id: string) => {
      calls.push(`discard:${id}`);
      return discardResult;
    }),
    markHeld: vi.fn(async (id: string, _ws: string, reason: string | null) => {
      calls.push(`held:${id}:${reason}`);
    }),
  };
  return { d, calls };
}

describe("holdDraft", () => {
  it("takes the draft out of review, then stamps it held (nothing sends)", async () => {
    const { d, calls } = deps();
    expect(await holdDraft("d1", "w1", null, d)).toEqual({});
    expect(calls).toEqual(["discard:d1", "held:d1:null"]);
  });

  it("keeps a short reason", async () => {
    const { d, calls } = deps();
    await holdDraft("d1", "w1", "  wait for her reply  ", d);
    expect(calls[1]).toBe("held:d1:wait for her reply");
  });

  it("does not stamp a draft that was already handled", async () => {
    const { d, calls } = deps({ error: "That draft was already handled." });
    expect(await holdDraft("d1", "w1", null, d)).toEqual({ error: "That draft was already handled." });
    expect(calls).toEqual(["discard:d1"]);
  });
});
