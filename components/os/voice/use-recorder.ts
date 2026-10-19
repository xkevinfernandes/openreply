"use client";

// Record from the mic with MediaRecorder. AAC/mp4 when the browser can
// (Safari), otherwise webm that prepare-audio converts to WAV on upload.

import { useEffect, useRef, useState } from "react";
import { recorderMime } from "@/components/os/voice/prepare-audio";

export type RecorderState = "idle" | "asking" | "recording" | "done" | "error";

export const MAX_RECORD_MS = 3 * 60_000;

export function useRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  /** 0-1 input level, for the live meter. */
  const [level, setLevel] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const raf = useRef<number | null>(null);
  const ctx = useRef<AudioContext | null>(null);

  function cleanup() {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void ctx.current?.close().catch(() => {});
    ctx.current = null;
    setLevel(0);
  }

  useEffect(() => cleanup, []);

  async function start() {
    setError(null);
    setBlob(null);
    setElapsed(0);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setState("error");
      setError("This browser can't record. Upload a file instead.");
      return;
    }
    setState("asking");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false } });
    } catch {
      setState("error");
      setError("Microphone access was blocked. Allow it in the browser's site settings.");
      return;
    }
    const mime = recorderMime();
    const r = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => {
      setBlob(new Blob(chunks, { type: r.mimeType || mime || "audio/webm" }));
      setState("done");
      cleanup();
    };
    rec.current = r;
    r.start(250);
    setState("recording");

    // Level meter + elapsed time on the display clock.
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx.current = new Ctx();
    const analyser = ctx.current.createAnalyser();
    analyser.fftSize = 512;
    ctx.current.createMediaStreamSource(stream.current).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const t0 = performance.now();
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
      setLevel((l) => l * 0.6 + Math.min(1, peak * 1.6) * 0.4);
      const ms = performance.now() - t0;
      setElapsed(ms);
      if (ms >= MAX_RECORD_MS) {
        stop();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }

  function stop() {
    if (rec.current && rec.current.state !== "inactive") rec.current.stop();
  }

  function reset() {
    if (rec.current) rec.current.onstop = null;
    stop();
    cleanup();
    setBlob(null);
    setElapsed(0);
    setError(null);
    setState("idle");
  }

  return { state, error, elapsed, blob, level, start, stop, reset };
}
