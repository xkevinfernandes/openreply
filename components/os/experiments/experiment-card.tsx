"use client";

// One test: the SetDM-style table (Variant | Sent | Reply | Value | Invite |
// Booked | Showed, every rate per send), booked-per-send with its range, the
// confidence hint, and pause / resume / pick winner.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  pickWinner,
  setExperimentStatus,
} from "@/app/(os)/os/automations/tests/actions";
import type { ExperimentView, VariantRow } from "@/lib/os/experiments/data";
import type { FunnelCounts } from "@/lib/os/experiments/funnel";
import { pct, rate } from "@/lib/os/experiments/stats";

const STEPS: { key: keyof FunnelCounts; label: string; hint: string }[] = [
  {
    key: "replied",
    label: "Reply",
    hint: "Wrote back after the line (a button tap counts)",
  },
  {
    key: "valueSent",
    label: "Value sent",
    hint: "A resource or lead magnet went out after it",
  },
  {
    key: "inviteSent",
    label: "Invite",
    hint: "J's invite or a booking proposal was sent",
  },
  { key: "booked", label: "Booked", hint: "A call was booked" },
  { key: "showed", label: "Showed", hint: "Moved to Showed or Won" },
];

const STATUS: Record<ExperimentView["status"], { word: string; tone: string }> =
  {
    RUNNING: { word: "Running", tone: "live" },
    PAUSED: { word: "Paused", tone: "paused" },
    FINISHED: { word: "Finished", tone: "done" },
  };

function RangeBar({ v, max }: { v: VariantRow; max: number }) {
  if (!v.counts.sent) return <span className="os-exp-dash">–</span>;
  const scale = (x: number) => `${Math.min(100, (x / max) * 100)}%`;
  return (
    <span
      className="os-exp-range"
      title={`95% range ${pct(v.booked.low)} to ${pct(v.booked.high)}`}
    >
      <span className="os-exp-range-track">
        <span
          className="os-exp-range-span"
          style={{
            left: scale(v.booked.low),
            width: `calc(${scale(v.booked.high)} - ${scale(v.booked.low)})`,
          }}
        />
        <span
          className="os-exp-range-dot"
          style={{ left: scale(v.booked.rate) }}
        />
      </span>
      <span className="os-exp-range-text">
        {pct(v.booked.low)}–{pct(v.booked.high)}
      </span>
    </span>
  );
}

export default function ExperimentCard({ exp }: { exp: ExperimentView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const status = STATUS[exp.status];
  const leaderId =
    exp.verdict.kind === "leader" || exp.verdict.kind === "no_clear_winner"
      ? exp.verdict.leaderId
      : null;
  const maxHigh = Math.max(0.05, ...exp.variants.map((v) => v.booked.high));
  const disabled = pending;

  const run = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.error) setError(r.error);
      setConfirming(null);
      router.refresh();
    });

  return (
    <section className="os-exp" aria-labelledby={`exp-${exp.id}`}>
      <header className="os-exp-head">
        <div className="os-exp-title">
          <div className="os-exp-meta">
            <span className="os-st" data-tone={status.tone}>
              <i />
              {status.word}
            </span>
            <span className="chip quiet">{exp.slotKind}</span>
            {exp.sample && <span className="chip flag">Sample numbers</span>}
            {exp.allocation === "WEIGHTED" && (
              <span className="chip quiet">Weighted</span>
            )}
          </div>
          <h2 id={`exp-${exp.id}`}>{exp.name}</h2>
          <p>
            {exp.slotLabel}
            {exp.setterName ? ` · ${exp.setterName} only` : ""} · since{" "}
            {new Date(exp.startedAt).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
            })}
          </p>
        </div>
        <div className="os-exp-actions">
          {exp.status === "RUNNING" && (
            <button
              type="button"
              className="os-button"
              disabled={disabled}
              onClick={() => run(() => setExperimentStatus(exp.id, "PAUSED"))}
            >
              Pause
            </button>
          )}
          {exp.status !== "RUNNING" && (
            <button
              type="button"
              className="os-button"
              disabled={disabled}
              onClick={() => run(() => setExperimentStatus(exp.id, "RUNNING"))}
            >
              Resume
            </button>
          )}
          {exp.status !== "FINISHED" && (
            <button
              type="button"
              className="os-button ghost"
              disabled={disabled}
              onClick={() => run(() => setExperimentStatus(exp.id, "FINISHED"))}
            >
              Finish
            </button>
          )}
        </div>
      </header>

      <div className="os-exp-scroll">
        <table className="os-exp-table">
          <thead>
            <tr>
              <th scope="col" className="os-exp-variant">
                Variant
              </th>
              <th scope="col" className="num">
                Sent
              </th>
              {STEPS.map((s) => (
                <th key={s.key} scope="col" className="num" title={s.hint}>
                  {s.label}
                </th>
              ))}
              <th
                scope="col"
                className="os-exp-rangecol"
                title="Booked per send, 95% Wilson range"
              >
                Booked per send
              </th>
              <th scope="col" className="os-exp-pick">
                <span className="sr-only">Winner</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {exp.variants.map((v) => {
              const winner = exp.winnerVariantId === v.id;
              return (
                <tr
                  key={v.id}
                  data-leader={leaderId === v.id || undefined}
                  data-inactive={!v.active || undefined}
                >
                  <th scope="row" className="os-exp-variant">
                    <div className="os-exp-vcell">
                      <span className="os-exp-label">{v.label}</span>
                      <span className="os-exp-text">
                        <span>{v.text}</span>
                        <small>
                          {!v.active && !winner ? "Off · " : ""}
                          {exp.allocation === "WEIGHTED"
                            ? `weight ${v.weight} · `
                            : ""}
                          {v.counts.edited
                            ? `${v.counts.edited} edited before sending`
                            : v.counts.assigned > v.counts.sent
                              ? `${v.counts.assigned - v.counts.sent} assigned, not sent yet`
                              : ""}
                        </small>
                      </span>
                    </div>
                  </th>
                  <td className="num">
                    <strong>{v.counts.sent.toLocaleString()}</strong>
                  </td>
                  {STEPS.map((s) => (
                    <td key={s.key} className="num">
                      <strong>
                        {v.counts.sent
                          ? pct(rate(v.counts[s.key], v.counts.sent))
                          : "–"}
                      </strong>
                      <small>{v.counts[s.key].toLocaleString()}</small>
                    </td>
                  ))}
                  <td className="os-exp-rangecol">
                    <RangeBar v={v} max={maxHigh} />
                  </td>
                  <td className="os-exp-pick">
                    {winner ? (
                      <span className="chip ready">Winner</span>
                    ) : confirming === v.id ? (
                      <span className="os-exp-confirm">
                        <button
                          type="button"
                          className="os-button primary"
                          disabled={disabled}
                          onClick={() => run(() => pickWinner(exp.id, v.id))}
                        >
                          Use {v.label} only
                        </button>
                        <button
                          type="button"
                          className="os-button ghost"
                          onClick={() => setConfirming(null)}
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="os-button ghost"
                        disabled={disabled || exp.status === "FINISHED"}
                        onClick={() => setConfirming(v.id)}
                      >
                        Pick
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="os-exp-variant">
                All variants
              </th>
              <td className="num">
                <strong>{exp.total.sent.toLocaleString()}</strong>
              </td>
              {STEPS.map((s) => (
                <td key={s.key} className="num">
                  <strong>
                    {exp.total.sent
                      ? pct(rate(exp.total[s.key], exp.total.sent))
                      : "–"}
                  </strong>
                </td>
              ))}
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      <footer className="os-exp-foot">
        <p className="os-exp-verdict" data-kind={exp.verdict.kind}>
          <i aria-hidden="true" />
          {exp.verdict.text}
        </p>
        {exp.winnerVariantId && (
          <p className="os-exp-note">
            Everyone new gets the winner. People who already had another variant
            keep theirs.
          </p>
        )}
        {exp.sample && (
          <p className="os-exp-note">
            Made-up numbers on sample data, so the screen has something to show.
          </p>
        )}
        {error && (
          <p className="os-exp-error" role="alert">
            {error}
          </p>
        )}
      </footer>
    </section>
  );
}
