"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { sendInboxMessage } from "@/app/(os)/os/inbox/actions";

export default function Composer({ igUserId, username }: { igUserId: string; username: string | null }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    setError(null);
    startTransition(async () => {
      const result = await sendInboxMessage(igUserId, text);
      if (result.error) {
        setError(result.error);
        return;
      }
      setText("");
      router.refresh();
    });
  }

  return (
    <form
      className="os-composer"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {error && (
        <p className="os-composer-error" role="alert">
          {error}
        </p>
      )}
      <label htmlFor="composer-text" className="sr-only">
        Message @{username ?? "them"}
      </label>
      <textarea
        id="composer-text"
        rows={2}
        placeholder={`Message @${username ?? "them"}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
        }}
      />
      <div className="os-composer-actions">
        <button type="button" className="os-button" disabled title="J drafts arrive in build step 3">
          Draft with J
        </button>
        <button type="submit" className="os-button primary" disabled={pending || !text.trim()}>
          {pending ? "Sending…" : "Send"}
        </button>
      </div>
    </form>
  );
}
