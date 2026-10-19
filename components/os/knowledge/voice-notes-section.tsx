"use client";

// Knowledge base → Voice notes. Bank lines go out automatically: when a
// message J sends contains the line and that person hasn't heard it, the
// recording goes instead of the words (once per person). Manual notes are
// only sent by hand from the Inbox composer's mic.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addVoiceClip, clearVoiceAudio, deleteVoiceClip, updateVoiceClip, applySampleTone, type VoiceClipPatch } from "@/app/(os)/os/knowledge/voice-actions";
import { Section, Switch } from "@/components/os/knowledge/fields";
import RecordBox from "@/components/os/voice/record-box";
import VoicePlayer from "@/components/os/voice/voice-player";
import type { VoiceClipView } from "@/lib/os/voice/clips";
import { matchable } from "@/lib/os/voice/match";

interface Props {
  setterId: string;
  clips: VoiceClipView[];
  /** OS_MOCK: offer a generated chime instead of recording. */
  sampleData: boolean;
}

export default function VoiceNotesSection({ setterId, clips, sampleData }: Props) {
  const router = useRouter();
  const [adding, startAdd] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const bank = clips.filter((c) => c.kind === "bank");
  const manual = clips.filter((c) => c.kind === "manual");
  const recorded = bank.filter((c) => c.url).length;
  const on = bank.filter((c) => c.active && c.url).length;

  function add(kind: "bank" | "manual") {
    setError(null);
    startAdd(async () => {
      const r = await addVoiceClip(setterId, kind);
      if (r.error) setError(r.error);
      router.refresh();
    });
  }

  return (
    <Section
      id="voice-notes"
      title="Voice notes"
      description={
        <>
          Your real recordings. When a message J sends contains a bank line word for word and that person hasn&apos;t heard it yet, the
          recording goes instead of the words. J sees the lines that are on and uses them where they fit. Say each line exactly as written,
          2–5 seconds, casual.
        </>
      }
      aside={
        <span className="os-vn-tally" aria-label="Recorded lines">
          <strong>{recorded}</strong>/{bank.length} recorded · <strong>{on}</strong> on
        </span>
      }
    >
      <h3 className="os-kb-sub">Bank lines (sent automatically)</h3>
      <ol className="os-vn-list">
        {bank.map((c) => (
          <ClipRow key={c.id} clip={c} sampleData={sampleData} />
        ))}
      </ol>
      <div className="os-vn-add">
        <button type="button" className="os-button" disabled={adding} onClick={() => add("bank")}>
          Add a line
        </button>
      </div>

      <h3 className="os-kb-sub">Manual notes (you send these)</h3>
      <p className="os-kb-help">Clips that never send on their own. Send them from the mic button in the Inbox, for example a welcome or a post-call thank-you.</p>
      {manual.length > 0 && (
        <ol className="os-vn-list">
          {manual.map((c) => (
            <ClipRow key={c.id} clip={c} sampleData={sampleData} />
          ))}
        </ol>
      )}
      <div className="os-vn-add">
        <button type="button" className="os-button" disabled={adding} onClick={() => add("manual")}>
          Add a manual note
        </button>
        {error && (
          <span className="os-kb-note" data-kind="error" role="alert">
            {error}
          </span>
        )}
      </div>
    </Section>
  );
}

function ClipRow({ clip, sampleData }: { clip: VoiceClipView; sampleData: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [phrase, setPhrase] = useState(clip.phrase);
  const [label, setLabel] = useState(clip.label);
  const [stage, setStage] = useState(clip.stage ?? "");
  const [recording, setRecording] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const bank = clip.kind === "bank";
  const short = bank && phrase.trim() && !matchable(phrase);

  function save(patch: VoiceClipPatch, ok = "Saved") {
    setNote(null);
    start(async () => {
      const r = await updateVoiceClip(clip.id, patch);
      setNote(r.error ? { kind: "error", text: r.error } : { kind: "ok", text: ok });
      router.refresh();
    });
  }

  function run(fn: () => Promise<{ error?: string }>) {
    setNote(null);
    start(async () => {
      const r = await fn();
      if (r.error) setNote({ kind: "error", text: r.error });
      router.refresh();
    });
  }

  return (
    <li className="os-vn-clip" data-active={clip.active && clip.url ? "true" : undefined} data-empty={clip.url ? undefined : "true"} aria-busy={pending}>
      <div className="os-vn-head">
        <input
          className="os-vn-label"
          aria-label="Label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => label !== clip.label && save({ label })}
        />
        <input
          className="os-vn-stage"
          aria-label="Stage"
          placeholder="Stage"
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          onBlur={() => stage !== (clip.stage ?? "") && save({ stage })}
        />
        <span className="os-vn-kind" role="radiogroup" aria-label="How it sends">
          {(["bank", "manual"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={clip.kind === k}
              disabled={pending}
              onClick={() => clip.kind !== k && save({ kind: k })}
            >
              {k === "bank" ? "Bank (auto)" : "Manual"}
            </button>
          ))}
        </span>
        <span className="os-vn-switch">
          <span>{clip.active && clip.url ? "On" : "Off"}</span>
          <Switch
            checked={clip.active && Boolean(clip.url)}
            disabled={pending || !clip.url}
            label={`${clip.label || "Clip"} on`}
            onChange={(v) => save({ active: v }, v ? "On" : "Off")}
          />
        </span>
      </div>

      <label className="os-vn-phrase">
        <span className="sr-only">{bank ? "The exact line" : "What you say"}</span>
        <textarea
          className="os-textarea"
          rows={2}
          value={phrase}
          placeholder={bank ? "The exact line, as you say it" : "What you say (shown in the thread)"}
          onChange={(e) => setPhrase(e.target.value)}
          onBlur={() => phrase.trim() !== clip.phrase && save({ phrase })}
        />
      </label>
      {short && <p className="os-vn-hint">Bank lines need at least 3 words, so they never match by accident.</p>}

      <div className="os-vn-audio">
        {clip.url && !recording && (
          <>
            <VoicePlayer url={clip.url} durationMs={clip.durationMs} tone="plain" label={clip.label} />
            <button type="button" className="os-button ghost" onClick={() => setRecording(true)} disabled={pending}>
              Re-record
            </button>
            <button type="button" className="os-link quiet" onClick={() => run(() => clearVoiceAudio(clip.id))} disabled={pending}>
              Remove recording
            </button>
          </>
        )}
        {(!clip.url || recording) && (
          <RecordBox
            clipId={clip.id}
            onSaved={() => {
              setRecording(false);
              setNote({ kind: "ok", text: clip.url ? "Replaced" : "Saved and switched on" });
              router.refresh();
            }}
            onCancel={recording ? () => setRecording(false) : undefined}
          />
        )}
        {!clip.url && sampleData && (
          <button type="button" className="os-link" onClick={() => run(() => applySampleTone(clip.id))} disabled={pending}>
            Use a sample chime
          </button>
        )}
      </div>

      <div className="os-vn-foot">
        {bank && (
          <label className="os-vn-check">
            <input type="checkbox" checked={clip.leadIn} disabled={pending} onChange={(e) => save({ leadIn: e.target.checked })} />
            Lead-in: plays at the start of a bubble, then the rest goes as text
          </label>
        )}
        <span className="os-vn-meta">
          {clip.sends > 0 ? `Heard by ${clip.sends} ${clip.sends === 1 ? "person" : "people"}` : bank ? "Plays once per person" : ""}
        </span>
        <span role="status" className="os-kb-note" data-kind={note?.kind}>
          {pending ? "Saving…" : note?.text}
        </span>
        <button
          type="button"
          className="os-link quiet"
          disabled={pending}
          onClick={() => {
            if (window.confirm(`Delete "${clip.label || clip.phrase || "this clip"}"? The recording goes too.`)) run(() => deleteVoiceClip(clip.id));
          }}
        >
          Delete
        </button>
      </div>
    </li>
  );
}
