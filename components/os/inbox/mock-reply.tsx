"use client";

// OS_MOCK only: write as them, so the booking flow (yes to a call → pick a
// time → email → screenshot) can be clicked through on sample data.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { simulateTheirReply } from "@/app/(os)/os/inbox/actions";

export default function MockReply({ conversationId, who }: { conversationId: string; who: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();

  function send(screenshot: boolean) {
    start(async () => {
      await simulateTheirReply(conversationId, text, screenshot);
      setText("");
      router.refresh();
    });
  }

  return (
    <form
      className="os-mock-reply"
      onSubmit={(e) => {
        e.preventDefault();
        send(false);
      }}
    >
      <span>Sample data: reply as {who}</span>
      <input className="os-input" aria-label={`What ${who} says`} placeholder="yeah let's do a call, I'm in London" value={text} onChange={(e) => setText(e.target.value)} />
      <button type="submit" className="os-button" disabled={pending || !text.trim()}>
        Send as them
      </button>
      <button type="button" className="os-button ghost" disabled={pending} onClick={() => send(true)}>
        Send a screenshot
      </button>
    </form>
  );
}
