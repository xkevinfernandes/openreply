// Send stamps on every send path (dm-crm issue 010): any module that calls a
// send endpoint must be on the stamp list, and each listed module stamps.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, sourceFiles } from "./source-scan";

/** Self-stamping DM primitives (lib/instagram/send-messages.ts wraps them). */
const STAMPED_PRIMITIVES = /\b(sendDirectMessage|sendDirectMessageWithButton|sendDirectMessageWithLinkButton)\s*\(/;
/** Endpoints a caller must stamp itself. */
const RAW_ENDPOINTS = [
  /\b(sendPrivateReply|sendPrivateReplyWithButton|sendPrivateReplyWithLinkButton|sendMessageWithQuickReplies)\s*\(/,
  /zernioRequest[\s\S]{0,400}?(\/messages`|private-reply`)/,
  /\/\$\{[^}]+\}\/messages`,\s*\{\s*method:\s*"POST"/,
];

/** The stamp list: who sends, and why that's covered. */
const STAMP_LIST: Record<string, string> = {
  "lib/instagram/send-messages.ts": "defines the primitives; the DM ones stamp (stamped())",
  "lib/meta/client.ts": "Graph primitives, wrapped by send-messages.ts",
  "lib/os/inbox.ts": "sendReply stamps (human for the composer)",
  "lib/os/voice/send.ts": "sendAudioMessage stamps (human for Kevin's voice notes)",
  "lib/os/workflows/ports.ts": "workflow DMs and private replies stamp (automated)",
  "lib/queue/dm-worker.ts": "keyword DMs via the primitives; private replies stamp after delivery",
  "app/api/instagram/conversations/route.ts": "upstream dashboard inbox: sendDirectMessage stamps itself",
};

const definesOnly = (src: string, re: RegExp) => {
  const calls = [...src.matchAll(new RegExp(re.source, "g"))];
  return calls.every((m) => /function\s+$/.test(src.slice(Math.max(0, (m.index ?? 0) - 20), m.index)));
};

describe("send stamp source scan", () => {
  const files = sourceFiles().filter((f) => !f.startsWith("lib/os/mock") && f !== "lib/os/send-stamp.ts");
  const senders = files.filter((f) => {
    const src = readFileSync(path.join(ROOT, f), "utf8");
    return [STAMPED_PRIMITIVES, ...RAW_ENDPOINTS].some((re) => re.test(src) && !definesOnly(src, re));
  });

  it("every module that calls a send endpoint is on the stamp list", () => {
    expect(senders.length).toBeGreaterThanOrEqual(5);
    expect(senders.filter((f) => !(f in STAMP_LIST))).toEqual([]);
  });

  it("each listed module that calls a raw endpoint stamps", () => {
    for (const f of Object.keys(STAMP_LIST)) {
      if (f === "lib/meta/client.ts" || f === "app/api/instagram/conversations/route.ts") continue;
      const src = readFileSync(path.join(ROOT, f), "utf8");
      expect(/stampSend|stamped\(|stampSendQuietly\(/.test(src), f).toBe(true);
    }
  });

  it("the composer and Kevin's voice notes are the only human stamps outside approveDraft", () => {
    const human = files.filter((f) => /human:\s*true/.test(readFileSync(path.join(ROOT, f), "utf8")));
    expect(human.sort()).toEqual(["app/(os)/os/inbox/actions.ts", "lib/os/voice/store.ts"]);
  });
});
