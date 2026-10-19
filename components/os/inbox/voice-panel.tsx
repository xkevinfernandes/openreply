"use client";

// The composer's mic: record a one-off voice note (Kevin's post-call notes)
// or send one of the setter's clips. These are Kevin's own sends, so they go
// straight out; J's drafts still wait for Approve.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { sendVoiceNote } from "@/app/(os)/os/inbox/voice-actions";
import RecordBox from "@/components/os/voice/record-box";
import VoicePlayer from "@/components/os/voice/voice-player";
import type { VoiceClipView } from "@/lib/os/voice/clips";

interface VoicePanelProps {
  contactId: string;
  who: string;
  clips: VoiceClipView[];
  onClose: () => void;
}

export default function VoicePanel({ contactId, who, clips, onClose }: VoicePanelProps) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send(input: { clipId?: string; audioId?: string; transcript?: string }, key: string) {
    setError(null);
    setSendingId(key);
    return new Promise<void>((resolve) =>
      start(async () => {
        const r = await sendVoiceNote(contactId, input);
        setSendingId(null);
        if (r.error) setError(r.error);
        else {
          router.refresh();
          onClose();
        }
        resolve();
      })
    );
  }

  return (
    <section className="os-voicepanel" aria-label="Send a voice note">
      <header className="os-voicepanel-head">
        <strong>Voice note to {who}</strong>
        <button type="button" className="os-voicepanel-close" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </header>

      <div className="os-voicepanel-record">
        <RecordBox
          keepLabel={sendingId === "oneoff" ? "Sending…" : "Send voice note"}
          onSaved={(audio) => send({ audioId: audio.id, transcript: note.trim() || undefined }, "oneoff")}
        />
        <label className="os-voicepanel-note">
          <span>What you say, in a few words (shows in the thread, optional)</span>
          <input className="os-input" value={note} maxLength={200} placeholder="e.g. thanks for the call, next steps" onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>

      {clips.length > 0 && (
        <>
          <h3 className="os-voicepanel-sub">Your clips</h3>
          <ul className="os-voicepanel-clips">
            {clips.map((c) => (
              <li key={c.id}>
                <span className="os-voicepanel-clip-text">
                  <span className="os-voicepanel-clip-label">
                    {c.label || "Clip"}
                    <span className="chip quiet">{c.kind === "manual" ? "Manual" : "Bank"}</span>
                  </span>
                  {c.phrase && <span className="os-voicepanel-clip-line">{c.phrase}</span>}
                </span>
                {c.url && <VoicePlayer url={c.url} durationMs={c.durationMs} tone="plain" label={c.label} />}
                <button type="button" className="os-button" disabled={pending} onClick={() => void send({ clipId: c.id }, c.id)}>
                  {sendingId === c.id ? "Sending…" : "Send"}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {clips.length === 0 && <p className="os-voicepanel-empty">No recorded clips yet. Record them in Knowledge bases → Voice notes.</p>}

      {error && (
        <p className="os-composer-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
