"use client";

// Record (or pick a file), listen back, then keep it. Used by the Voice notes
// section (per clip) and the composer's mic panel (one-off notes).

import { useEffect, useMemo, useRef, useState } from "react";
import { uploadAudio, type UploadedAudio } from "@/components/os/voice/prepare-audio";
import { MAX_RECORD_MS, useRecorder } from "@/components/os/voice/use-recorder";
import VoicePlayer from "@/components/os/voice/voice-player";
import { formatDuration } from "@/lib/os/voice/audio";

interface RecordBoxProps {
  /** Attach to this clip on upload; without it the upload is a one-off. */
  clipId?: string | null;
  /** Called with the stored audio once it's uploaded. */
  onSaved: (audio: UploadedAudio) => void | Promise<void>;
  onCancel?: () => void;
  /** Button text for keeping the take. */
  keepLabel?: string;
  /** Start recording as soon as it shows (the composer's mic). */
  autoStart?: boolean;
  allowUpload?: boolean;
}

export default function RecordBox({ clipId, onSaved, onCancel, keepLabel = "Use this take", autoStart, allowUpload = true }: RecordBoxProps) {
  const r = useRecorder();
  const [file, setFile] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const take = file ?? r.blob;
  const preview = useMemo(() => (take ? URL.createObjectURL(take) : null), [take]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  const started = useRef(false);
  useEffect(() => {
    if (autoStart && !started.current) {
      started.current = true;
      void r.start();
    }
  }, [autoStart, r]);

  async function keep() {
    if (!take) return;
    setBusy(true);
    setError(null);
    try {
      const audio = await uploadAudio(take, clipId);
      await onSaved(audio);
      setFile(null);
      r.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The recording didn't save.");
    } finally {
      setBusy(false);
    }
  }

  function redo() {
    setFile(null);
    setError(null);
    r.reset();
  }

  const recording = r.state === "recording" || r.state === "asking";

  return (
    <div className="os-rec" data-state={take ? "take" : recording ? "recording" : "idle"}>
      {!take && !recording && (
        <div className="os-rec-row">
          <button type="button" className="os-button os-rec-start" onClick={() => void r.start()}>
            <span className="os-rec-dot" aria-hidden="true" />
            Record
          </button>
          {allowUpload && (
            <>
              <button type="button" className="os-button ghost" onClick={() => fileInput.current?.click()}>
                Upload a file
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="audio/*,.m4a,.mp3,.wav,.aac,.ogg,.webm"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) setFile(f);
                }}
              />
            </>
          )}
          {onCancel && (
            <button type="button" className="os-link quiet" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      )}

      {recording && (
        <div className="os-rec-row" role="status">
          <span className="os-rec-live" aria-hidden="true">
            <span className="os-rec-dot" />
          </span>
          <span className="os-rec-meter" aria-hidden="true">
            <span style={{ transform: `scaleX(${Math.max(0.04, r.level)})` }} />
          </span>
          <span className="os-rec-time">
            {r.state === "asking" ? "Allow the mic…" : `${formatDuration(r.elapsed) || "0:00"} / ${formatDuration(MAX_RECORD_MS)}`}
          </span>
          <button type="button" className="os-button primary" onClick={r.stop} disabled={r.state !== "recording"}>
            Stop
          </button>
        </div>
      )}

      {take && preview && (
        <div className="os-rec-row">
          <VoicePlayer url={preview} durationMs={null} tone="plain" label="your take" />
          <button type="button" className="os-button ghost" onClick={redo} disabled={busy}>
            {file ? "Pick another" : "Redo"}
          </button>
          <button type="button" className="os-button primary" onClick={() => void keep()} disabled={busy}>
            {busy ? "Saving…" : keepLabel}
          </button>
        </div>
      )}

      {(error || r.error) && (
        <p className="os-rec-error" role="alert">
          {error ?? r.error}
        </p>
      )}
    </div>
  );
}
