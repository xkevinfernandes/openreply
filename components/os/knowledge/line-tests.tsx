"use client";

// Setup › Tests: real A/B tests of J's stage lines. One row per line; a test
// shows its versions with reached → replied → next stage → booked → showed.
// Each person gets one version the first time J's line goes out to them, and
// keeps it. Only messages that went out count.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createLineTest, deleteLineDraft, pickLineWinner, resumeLineTest, saveLineDraft, stopLineTest } from "@/app/(os)/os/knowledge/tests-actions";
import { Section } from "@/components/os/knowledge/fields";
import { KbIcon } from "@/components/os/knowledge/icons";
import type { LineTestView, LineVariantView, StageLineRow } from "@/lib/os/experiments/data";
import { LINE_MIN_REACHED, pct } from "@/lib/os/experiments/stats";
import { MAX_LINE_VARIANTS } from "@/lib/os/experiments/validate";

type Act = () => Promise<{ error?: string }>;

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(fn: Act, after?: () => void) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else {
        after?.();
        router.refresh();
      }
    });
  }
  return { pending, error, run };
}

/** `workflowId`: new tests are scoped to that workflow (the Setter step's Tests tab). `bare`: no section frame. */
export default function LineTests({ setterId, setterName, rows, workflowId, bare }: { setterId: string; setterName: string; rows: StageLineRow[]; workflowId?: string; bare?: boolean }) {
  const list = (
    <ul className="kb-lt">
      {rows.map((row) => (
        <LineRow key={row.key} setterId={setterId} setterName={setterName} row={row} workflowId={workflowId} />
      ))}
    </ul>
  );
  if (bare) return list;
  return (
    <Section
      id="tests"
      title="Tests"
      description="Each person gets A or B the first time J reaches the line, and keeps it. Only messages that went out count. Judged on replies once 30 people reached each version."
    >
      {list}
    </Section>
  );
}

function LineRow({ setterId, setterName, row, workflowId }: { setterId: string; setterName: string; row: StageLineRow; workflowId?: string }) {
  const [adding, setAdding] = useState(false);
  const running = row.tests.some((t) => t.status === "RUNNING");
  return (
    <li className="kb-lt-row" aria-label={row.label}>
      <div className="kb-lt-line">
        <span className="kb-lt-name">{row.label}</span>
        {!row.tests.length && !adding && <span className="kb-quiet">No test</span>}
        <span className="kb-grow" />
        {!adding && !running && (
          <button type="button" className="kb-btn" onClick={() => setAdding(true)} aria-label={`Add test: ${row.label}`}>
            <KbIcon name="plus" size={11} />
            Test
          </button>
        )}
      </div>
      {adding && <Editor label={row.label} initial={["", ""]} onClose={() => setAdding(false)} create={{ setterId, line: row.key, workflowId }} />}
      {row.tests.map((t) => (
        <TestCard key={t.id} setterId={setterId} setterName={setterName} label={row.label} test={t} />
      ))}
    </li>
  );
}

function scopeText(t: LineTestView, setterName: string): string {
  const where = t.scope === "workflow" ? "This workflow" : t.scope === "all" ? "Every setter" : `All of ${setterName}`;
  return t.entry ? `${where} · ${t.entry}` : where;
}

const STATUS: Record<LineTestView["status"], string> = { RUNNING: "Running", PAUSED: "Paused", DRAFT: "Draft", FINISHED: "Stopped" };

function TestCard({ setterId, setterName, label, test: t }: { setterId: string; setterName: string; label: string; test: LineTestView }) {
  const act = useAct();
  if (t.status === "DRAFT") {
    return (
      <div className="kb-lt-test" data-status="draft">
        <div className="kb-lt-head">
          <span className="kb-lt-status" data-status="draft">
            Draft
          </span>
          <span className="kb-chip">{scopeText(t, setterName)}</span>
        </div>
        <Editor label={label} initial={t.variants.map((v) => v.text)} draft={{ setterId, id: t.id }} />
      </div>
    );
  }
  const v = t.verdict;
  const leader = v.kind === "leader" ? v.leaderId : null;
  const metric = v.kind === "leader" || v.kind === "tie" ? v.metric : "replied";
  const live = t.variants.filter((x) => x.active);
  const canPick = t.status === "RUNNING" && !t.winnerVariantId && live.length > 1 && !t.sample;
  return (
    <section className="kb-lt-test" aria-label={`${label} test`} data-status={t.status.toLowerCase()}>
      <div className="kb-lt-head">
        <span className="kb-lt-status" data-status={t.status.toLowerCase()}>
          {t.winnerVariantId ? "Winner picked" : STATUS[t.status]}
        </span>
        <span className="kb-chip">{scopeText(t, setterName)}</span>
        {t.sample && <span className="kb-chip">Sample</span>}
        <span className="kb-grow" />
        {v.kind === "too_early" && <span className="kb-quiet">Too early</span>}
        {t.status === "PAUSED" && (
          <button type="button" className="kb-btn" disabled={act.pending || t.sample} onClick={() => act.run(() => resumeLineTest(setterId, t.id))}>
            Resume
          </button>
        )}
        <button type="button" className="kb-btn" disabled={act.pending || t.sample} onClick={() => act.run(() => stopLineTest(setterId, t.id))}>
          Stop
        </button>
      </div>
      <div className="kb-lt-grid kb-lt-cols" aria-hidden="true">
        <span />
        <span>Reached</span>
        <span>Replied</span>
        <span>Next</span>
        <span>Booked</span>
        <span>Showed</span>
      </div>
      {t.variants.map((x) => (
        <Variant
          key={x.id}
          v={x}
          lead={leader === x.id}
          metric={metric}
          winner={t.winnerVariantId === x.id}
          onPick={canPick && x.active ? () => act.run(() => pickLineWinner(setterId, t.id, x.id)) : undefined}
          pending={act.pending}
        />
      ))}
      {act.error && (
        <p className="kb-note" data-kind="error" role="alert">
          {act.error}
        </p>
      )}
    </section>
  );
}

function rate(n: number, of: number) {
  return of > 0 ? pct(n / of) : "–";
}

function Variant({
  v,
  lead,
  metric,
  winner,
  onPick,
  pending,
}: {
  v: LineVariantView;
  lead: boolean;
  metric: "replied" | "booked";
  winner: boolean;
  onPick?: () => void;
  pending: boolean;
}) {
  const c = v.counts;
  const cell = (n: number, key: "replied" | "nextStage" | "booked" | "showed") => (
    <span title={`${n} of ${c.sent}`} data-strong={(key === metric) || undefined}>
      {rate(n, c.sent)}
    </span>
  );
  return (
    <div className="kb-lt-var" data-off={v.active ? undefined : "true"}>
      <div className="kb-lt-grid">
        <span className="kb-lt-label">
          <span className="kb-lt-badge" data-lead={lead || winner || undefined}>
            {v.label}
          </span>
          {lead && (
            <span className="kb-lt-mark" title={`Leading on ${metric === "booked" ? "bookings" : "replies"}`} aria-label={`Leading on ${metric === "booked" ? "bookings" : "replies"}`}>
              ▲
            </span>
          )}
          {winner && <span className="kb-quiet">Winner</span>}
          {c.edited > 0 && <span className="kb-quiet" title="Sent after a heavy edit (still counted)">{c.edited} edited</span>}
          {onPick && (
            <button type="button" className="os-link quiet" disabled={pending} onClick={onPick} title="Everyone new gets this one. People who already got the other keep it.">
              Pick winner
            </button>
          )}
        </span>
        <span>{c.sent}</span>
        {cell(c.replied, "replied")}
        {cell(c.nextStage, "nextStage")}
        {cell(c.booked, "booked")}
        {cell(c.showed, "showed")}
      </div>
      <span className="kb-lt-text">{v.text}</span>
    </div>
  );
}

function Editor({
  label,
  initial,
  onClose,
  create,
  draft,
}: {
  label: string;
  initial: string[];
  onClose?: () => void;
  create?: { setterId: string; line: string; workflowId?: string };
  draft?: { setterId: string; id: string };
}) {
  const [texts, setTexts] = useState<string[]>(initial.length >= 2 ? initial : [...initial, ""].slice(0, Math.max(2, initial.length)));
  const act = useAct();
  const set = (i: number, x: string) => setTexts((list) => list.map((t, j) => (j === i ? x : t)));
  const save = (start: boolean) =>
    act.run(
      () => (create ? createLineTest(create.setterId, { line: create.line, texts, start, workflowId: create.workflowId }) : saveLineDraft(draft!.setterId, draft!.id, texts, start)),
      create ? onClose : undefined
    );
  return (
    <div className="kb-lt-edit">
      {texts.map((t, i) => (
        <label key={i} className="kb-lt-field">
          <span className="kb-lt-badge">{String.fromCharCode(65 + i)}</span>
          <textarea
            className="os-input"
            rows={2}
            value={t}
            aria-label={`${label} ${String.fromCharCode(65 + i)}`}
            placeholder={i === 0 ? "how J says it now" : "another way to say it"}
            onChange={(e) => set(i, e.target.value)}
          />
        </label>
      ))}
      <div className="kb-lt-line">
        {texts.length < MAX_LINE_VARIANTS && (
          <button type="button" className="os-link" onClick={() => setTexts((l) => [...l, ""])}>
            Add {String.fromCharCode(65 + texts.length)}
          </button>
        )}
        <span className="kb-note" data-kind={act.error ? "error" : undefined} role="status">
          {act.error ?? ""}
        </span>
        <span className="kb-grow" />
        {onClose && (
          <button type="button" className="kb-btn" onClick={onClose} disabled={act.pending}>
            Cancel
          </button>
        )}
        {draft && (
          <button type="button" className="kb-btn" disabled={act.pending} onClick={() => act.run(() => deleteLineDraft(draft.setterId, draft.id))}>
            Delete
          </button>
        )}
        <button type="button" className="kb-btn" disabled={act.pending} onClick={() => save(false)}>
          {create ? "Save draft" : "Save"}
        </button>
        <button type="button" className="kb-btn kb-btn-p" disabled={act.pending} onClick={() => save(true)} title={`Each version needs ${LINE_MIN_REACHED} people before it's judged`}>
          Start
        </button>
      </div>
    </div>
  );
}
