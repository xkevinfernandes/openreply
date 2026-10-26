// The send cap, Kevin's composer (dm-crm 027, seam 5): with the cap full and
// Pause all on, the composer (sendReply with fromComposer) and Send myself
// still send and are recorded as "manual", which the cap doesn't count; every
// other path is still held. Only the composer and Send myself pass fromComposer.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const held = vi.hoisted(() => ({ reason: "cap" as "cap" | "paused", recorded: [] as string[], sent: [] as string[] }));

vi.mock("@/lib/os/sending/cap", async (orig) => {
  const real = await orig<typeof import("@/lib/os/sending/cap")>();
  return {
    ...real,
    assertCanSend: async (_w: string, _n: number, deps: { source?: string } = {}) => {
      const state = { sentToday: 80, cap: 80, pausedAll: held.reason === "paused", remaining: 0, timezone: "UTC" };
      const blocked = real.checkSend(state, 1, (deps.source ?? "setter") as never);
      if (blocked) throw new real.SendBlockedError(blocked, state);
      return state;
    },
    recordSend: async (_w: string, o: { source?: string } = {}) => void held.recorded.push(o.source ?? "?"),
  };
});
vi.mock("@/lib/os/send-stamp", () => ({ stampSend: async () => undefined }));
vi.mock("@/lib/os/workflows/hooks", () => ({ sendNotedOs: async (_w: string, _i: string, t: string, fn: () => Promise<void>) => (held.sent.push(t), fn()) }));
vi.mock("@/lib/os/mock", async (orig) => ({ ...(await orig<typeof import("@/lib/os/mock")>()), osMockEnabled: () => true, appendMockMessage: () => undefined }));

beforeEach(() => {
  held.recorded.length = 0;
  held.sent.length = 0;
});

describe("Kevin's composer and the cap", () => {
  it("with the cap full, the composer still sends and is recorded as manual (not counted)", async () => {
    held.reason = "cap";
    const { sendReply } = await import("@/lib/os/inbox");
    await sendReply("w", "ig1", "hey", { source: "manual", human: true, fromComposer: true });
    expect(held.sent).toEqual(["hey"]);
    expect(held.recorded).toEqual(["manual"]);
  });

  it("Pause all holds neither the composer nor Send myself, but holds J and broadcasts", async () => {
    held.reason = "paused";
    const { sendReply } = await import("@/lib/os/inbox");
    await sendReply("w", "ig1", "mine", { source: "manual", human: true, fromComposer: true });
    await expect(sendReply("w", "ig1", "j", { source: "setter" })).rejects.toThrow(/Pause all/);
    await expect(sendReply("w", "ig1", "b", { source: "broadcast" })).rejects.toThrow(/Pause all/);
    expect(held.sent).toEqual(["mine"]);
  });

  it("with the cap full, J's approved draft is still blocked", async () => {
    held.reason = "cap";
    const { sendReply } = await import("@/lib/os/inbox");
    await expect(sendReply("w", "ig1", "j", { source: "setter" })).rejects.toThrow(/limit/);
    expect(held.sent).toEqual([]);
  });
});

describe("who passes fromComposer (source scan)", () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      if (f === "node_modules" || f === "generated" || f.startsWith(".")) return [];
      return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
    });
  }
  it("only the inbox composer (and Send myself through it) and Kevin's voice note", () => {
    const root = process.cwd();
    const hits = ["app", "lib", "components", "worker"]
      .flatMap((d) => {
        try {
          return files(join(root, d));
        } catch {
          return [];
        }
      })
      .filter((f) => /fromComposer:\s*true/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(root.length + 1))
      .sort();
    expect(hits).toEqual(["app/(os)/os/inbox/actions.ts", "lib/os/voice/store.ts"]);
  });
});
