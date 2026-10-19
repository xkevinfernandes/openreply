"use client";

// A voice note, the way Instagram draws one: a round play button, a row of
// bars that fill as it plays, the length. The line said sits underneath as a
// transcript. One player plays at a time on the page.

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDuration } from "@/lib/os/voice/audio";

const BARS = 28;

/** Stable, natural-looking bar heights from the url (no decoding needed). */
function bars(seed: string): number[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return Array.from({ length: BARS }, (_, i) => {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
    const r = ((h >>> 0) % 1000) / 1000;
    const shape = Math.sin((i / (BARS - 1)) * Math.PI) * 0.55 + 0.35;
    return Math.max(0.18, Math.min(1, shape * (0.55 + r * 0.7)));
  });
}

let current: HTMLAudioElement | null = null;

interface VoicePlayerProps {
  url: string;
  durationMs: number | null;
  transcript?: string | null;
  /** me: a sent bubble (ink). draft: J's draft (outlined). plain: a list row. */
  tone?: "me" | "draft" | "plain";
  label?: string;
}

export default function VoicePlayer({ url, durationMs, transcript, tone = "plain", label }: VoicePlayerProps) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [length, setLength] = useState<number | null>(durationMs);
  const [failed, setFailed] = useState(false);
  const heights = useMemo(() => bars(url), [url]);

  useEffect(() => {
    const a = audio.current;
    return () => {
      a?.pause();
      if (current === a) current = null;
    };
  }, []);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const a = audio.current;
      if (a && a.duration && Number.isFinite(a.duration)) setProgress(a.currentTime / a.duration);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  function toggle() {
    const a = audio.current;
    if (!a) return;
    if (!a.paused) {
      a.pause();
      return;
    }
    if (current && current !== a) current.pause();
    current = a;
    a.play().catch(() => setFailed(true));
  }

  const left = playing && length ? length * (1 - progress) : length;

  return (
    <span className="os-voice" data-tone={tone} data-playing={playing ? "true" : undefined}>
      <span className="os-voice-row">
        <button
          type="button"
          className="os-voice-play"
          onClick={toggle}
          aria-label={`${playing ? "Pause" : "Play"} voice note${label ? `: ${label}` : ""}`}
          disabled={failed}
        >
          {playing ? (
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <rect x="4" y="3" width="2.6" height="10" rx="1" />
              <rect x="9.4" y="3" width="2.6" height="10" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M5 3.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L5.9 2.7a.6.6 0 0 0-.9.5Z" />
            </svg>
          )}
        </button>
        <span
          className="os-voice-wave"
          role="progressbar"
          aria-label="Played"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          onClick={(e) => {
            const a = audio.current;
            if (!a || !a.duration || !Number.isFinite(a.duration)) return;
            const r = e.currentTarget.getBoundingClientRect();
            a.currentTime = ((e.clientX - r.left) / r.width) * a.duration;
            setProgress(a.currentTime / a.duration);
          }}
        >
          {heights.map((h, i) => (
            <i key={i} style={{ height: `${Math.round(h * 100)}%` }} data-on={i / BARS < progress ? "true" : undefined} />
          ))}
        </span>
        <span className="os-voice-time">{failed ? "Can't play" : formatDuration(left) || "0:00"}</span>
      </span>
      {transcript && <span className="os-voice-line">“{transcript}”</span>}
      <audio
        ref={audio}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setLength(Math.round(d * 1000));
        }}
        onError={() => setFailed(true)}
      />
    </span>
  );
}
