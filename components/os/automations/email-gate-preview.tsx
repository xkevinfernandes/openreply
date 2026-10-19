"use client";

/* eslint-disable @next/next/no-img-element */

// The email-first step in the builder's phone preview (one-line hook in
// components/campaign-preview.tsx). Same order as the worker
// (lib/queue/dm-worker.ts sendRevealOrEmailPrompt → processEmailGateReply):
// after the tap (and the follow check) we ask for their email, they answer,
// and only then does the link message (the preview's next bubble) go out.
// Same bubble classes as the preview around it.

/** lib/email-gate.ts DEFAULT_EMAIL_PROMPT (that module is server-only). */
const DEFAULT_PROMPT = "what's the best email to send it to?";
const SAMPLE_EMAIL = "username@gmail.com";

export default function EmailGatePreview({ prompt, avatarUrl }: { prompt: string; avatarUrl: string | null }) {
  const text = (prompt.trim() || DEFAULT_PROMPT).replace(/\{username\}/g, "username");
  return (
    <>
      <div className="flex items-end gap-2">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" referrerPolicy="no-referrer" className="shrink-0 rounded-full object-cover" style={{ width: 24, height: 24 }} />
        ) : (
          <span className="shrink-0 rounded-full bg-zinc-600" style={{ width: 24, height: 24 }} />
        )}
        <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-zinc-800 px-3 py-2">
          <p className="whitespace-pre-wrap text-sm">{text}</p>
        </div>
      </div>
      <div className="flex justify-end">
        <div className="rounded-2xl rounded-br-md bg-accent px-3 py-2 text-sm">{SAMPLE_EMAIL}</div>
      </div>
    </>
  );
}
