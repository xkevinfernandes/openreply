import { describe, expect, it, vi } from "vitest";

const sendBroadcastJob = vi.fn(async () => ({ status: "sent", followupAt: null }));
vi.mock("@/lib/os/broadcasts/send", () => ({ sendBroadcastJob }));
vi.mock("@/lib/db/client", () => ({ prisma: {} }));
vi.mock("@/lib/queue/client", () => ({ getRedisConnection: () => ({}) }));

describe("worker os-broadcast-send slot", () => {
  it("hands the job to sendBroadcastJob", async () => {
    const { processSetterJob, SETTER_BROADCAST_SEND_JOB } = await import("@/lib/os/setter/queue");
    const data = { messageId: "m1", part: "main" as const, at: 123 };
    await processSetterJob({ name: SETTER_BROADCAST_SEND_JOB, data } as never);
    expect(sendBroadcastJob).toHaveBeenCalledWith(data);
  });
});
