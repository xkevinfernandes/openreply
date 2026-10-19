"use client";

// Sandbox v2 (Knowledge bases › Test, SandboxV2 board). You write as the
// lead; the same messages go to column A and column B, each with its own
// forced test lines. Run 5× shows how much J varies. Tools are dry (shown in
// the trace, never run) unless "Really book" is on and confirmed. Nothing
// here is sent, counted or synced; the chat lives in this tab only.

import { useEffect, useMemo, useRef, useState } from "react";
import { runSandbox, type SandboxRunOptions } from "@/app/(os)/os/knowledge/actions";
import InspectDrawer from "@/components/os/inspect/inspect-drawer";
import { SetterMark } from "@/components/os/ui";
import { viewFromLegacy, viewFromTrace, type InspectView } from "@/lib/os/setter/inspect/view";
import type { SandboxReply } from "@/lib/os/setter/sandbox";
import { historyOf, labelsOf, REALLY_BOOK_CONFIRM, type Force, type Goal, type LeadMagnet, type TestLine } from "@/lib/os/setter/sandbox-options";

interface Entry {
  slug: string;
  name: string;
  keyword: string | null;
  opener: string;
}

interface Run {
  reply: SandboxReply;
  lines: { key: string; variantId: string }[];
}

type Turn = { from: "lead"; text: string } | { from: "setter"; runs: Run[]; pick: number };

interface Column {
  picks: Record<string, Force>;
  turns: Turn[];
}

interface Sit {
  entry: string;
  goal: Goal;
  leadMagnet: LeadMagnet;
  resource: string;
  fields: { key: string; value: string }[];
}

interface Saved {
  sit: Sit;
  cols: Column[];
  side: boolean;
}

const RUNS = 5;

const DEFAULT_FIELDS = [
  { key: "First name", value: "Sam" },
  { key: "Niche", value: "" },
  { key: "Email", value: "" },
];

function load(key: string): Saved | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

const icon = (d: string, size = 14) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const I_RESET = "M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.5h-2.5";
const I_PLUS = "M8 3.5v9M3.5 8h9";
const I_X = "M4.5 4.5l7 7M11.5 4.5l-7 7";
const I_LEFT = "M10 4 6 8l4 4";
const I_RIGHT = "m6 4 4 4-4 4";

interface Props {
  setterId: string;
  setterName: string;
  entries: Entry[];
  magnets: { slug: string; title: string }[];
  tests: TestLine[];
  backend: string;
}

export default function Sandbox({ setterId, setterName, entries, magnets, tests, backend }: Props) {
  const key = `os-sandbox2:${setterId}`;
  const startCols = (): Column[] => ["A", "B"].map((v) => ({ picks: Object.fromEntries(tests.map((t) => [t.experimentId, v as Force])), turns: [] }));
  const [sit, setSit] = useState<Sit>({ entry: "", goal: "book_call", leadMagnet: "none", resource: magnets[0]?.slug ?? "", fields: DEFAULT_FIELDS });
  const [cols, setCols] = useState<Column[]>(startCols);
  const [side, setSide] = useState(true);
  const [reallyBook, setReallyBook] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<number[]>([0, 0]);
  const [error, setError] = useState<string | null>(null);
  const [inspect, setInspect] = useState<InspectView | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const saved = load(key);
    if (!saved) return;
    /* eslint-disable react-hooks/set-state-in-effect -- one-time restore from sessionStorage */
    setSit(saved.sit);
    setCols(saved.cols);
    setSide(saved.side);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [key]);

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify({ sit, cols, side } satisfies Saved));
    } catch {
      // private mode or too big: the chat just won't survive a reload
    }
  }, [key, sit, cols, side]);

  const labels = useMemo(() => labelsOf(tests), [tests]);
  const opener = entries.find((e) => e.slug === sit.entry) ?? null;
  const active = side ? [0, 1] : [0];
  const thinking = busy.some((n) => n > 0);
  const started = cols.some((c) => c.turns.length > 0);
  const lead = sit.fields.find((f) => /name/i.test(f.key) && f.value.trim())?.value.trim() || "the lead";

  function options(c: Column): SandboxRunOptions {
    return {
      picks: c.picks,
      situation: { goal: sit.goal, leadMagnet: sit.leadMagnet, resource: sit.leadMagnet === "none" ? null : sit.resource || null, fields: sit.fields },
      reallyBook,
      confirm: reallyBook ? REALLY_BOOK_CONFIRM : null,
    };
  }

  const bump = (i: number, d: number) => setBusy((b) => b.map((n, j) => (j === i ? Math.max(0, n + d) : n)));

  /** Ask J `times` times for the turn after `history`; runs fill in as they come. */
  async function ask(i: number, history: Turn[], times: number) {
    const col = cols[i];
    setCols((cs) => cs.map((c, j) => (j === i ? { ...c, turns: [...history, { from: "setter", runs: [], pick: 0 }] } : c)));
    bump(i, 1);
    try {
      for (let n = 0; n < times; n++) {
        const r = await runSandbox(setterId, historyOf(history), sit.entry || null, options(col));
        if (r.error || !r.reply) {
          setError(r.error ?? "J couldn't answer.");
          break;
        }
        const run: Run = { reply: r.reply, lines: r.lines ?? [] };
        setCols((cs) =>
          cs.map((c, j) => {
            if (j !== i) return c;
            const last = c.turns[c.turns.length - 1];
            if (!last || last.from !== "setter") return c;
            return { ...c, turns: [...c.turns.slice(0, -1), { ...last, runs: [...last.runs, run] }] };
          })
        );
      }
    } finally {
      bump(i, -1);
      // A turn that got no answer at all goes away.
      setCols((cs) => cs.map((c, j) => (j === i && c.turns.at(-1)?.from === "setter" && (c.turns.at(-1) as { runs: Run[] }).runs.length === 0 ? { ...c, turns: c.turns.slice(0, -1) } : c)));
    }
  }

  function send() {
    const t = text.trim();
    if (!t || thinking) return;
    setError(null);
    setText("");
    for (const i of active) {
      const history: Turn[] = [...cols[i].turns, { from: "lead", text: t }];
      void ask(i, history, 1);
    }
  }

  /** Run J's last turn 5 times per column, to see how much he varies. */
  function runFive() {
    if (thinking) return;
    setError(null);
    for (const i of active) {
      const turns = cols[i].turns;
      let cut = turns.length;
      while (cut > 0 && turns[cut - 1].from === "setter") cut--;
      if (!cut) continue;
      void ask(i, turns.slice(0, cut), RUNS);
    }
  }

  function reset() {
    setCols((cs) => cs.map((c) => ({ ...c, turns: [] })));
    setError(null);
    setInspect(null);
    inputRef.current?.focus();
  }

  function toggleReallyBook() {
    if (reallyBook) return setReallyBook(false);
    if (window.confirm("Really book? A call J books here goes on your real calendar as a test event. Nothing else runs.")) setReallyBook(true);
  }

  function setPick(i: number, exp: string, f: Force) {
    setCols((cs) => cs.map((c, j) => (j === i ? { ...c, picks: { ...c.picks, [exp]: f } } : c)));
  }

  function page(i: number, d: number) {
    setCols((cs) =>
      cs.map((c, j) => {
        if (j !== i) return c;
        const last = c.turns.at(-1);
        if (!last || last.from !== "setter" || last.runs.length < 2) return c;
        const pick = (last.pick + d + last.runs.length) % last.runs.length;
        return { ...c, turns: [...c.turns.slice(0, -1), { ...last, pick }] };
      })
    );
  }

  function openTrace(run: Run) {
    const r = run.reply;
    const stepOverride = { goal: sit.goal, leadMagnet: { mode: sit.leadMagnet, resources: sit.leadMagnet === "none" ? [] : magnets.filter((m) => m.slug === sit.resource).map((m) => ({ ...m, released: false })) } };
    setInspect(
      r.trace
        ? viewFromTrace(r.trace, { source: "sandbox", variantLabels: labels, stage: r.stage, stepOverride })
        : viewFromLegacy({
            at: new Date().toISOString(),
            source: "sandbox",
            bubbles: r.bubbles,
            hold: r.hold,
            reasoning: r.reasoning,
            stage: r.stage,
            backend: r.usage.backend,
            model: r.usage.model,
            inputTokens: r.usage.inputTokens ?? null,
            outputTokens: r.usage.outputTokens ?? null,
            cacheReadTokens: r.usage.cacheReadTokens ?? null,
            prompt: r.prompt ?? null,
            raw: r,
          })
    );
  }

  const canRun = active.some((i) => cols[i].turns.some((t) => t.from === "lead"));

  return (
    <div className="os-sbx" data-inspect={inspect ? "true" : undefined}>
      <div className="os-sbx-bar">
        <label className="os-sbx-switch" title="Sandbox actions are shown in the trace, never run">
          <button type="button" role="switch" aria-checked={!reallyBook} aria-label="Dry tools" className="os-switch" disabled>
            <span className="os-switch-knob" />
          </button>
          Dry tools
        </label>
        <label className="os-sbx-switch" title="Book a real test event on your calendar when J books">
          <button type="button" role="switch" aria-checked={reallyBook} aria-label="Really book (test event)" className="os-switch" onClick={toggleReallyBook}>
            <span className="os-switch-knob" />
          </button>
          Really book
        </label>
        <label className="os-sbx-switch">
          <button type="button" role="switch" aria-checked={side} aria-label="Side by side" className="os-switch" onClick={() => setSide((s) => !s)} disabled={thinking}>
            <span className="os-switch-knob" />
          </button>
          A / B
        </label>
        <span className="os-sbx-sp" />
        {backend === "fake" ? <span className="os-sbx-note">Sample replies</span> : null}
        <button type="button" className="os-icon-btn" aria-label="Reset" title="Reset" onClick={reset} disabled={!started || thinking}>
          {icon(I_RESET)}
        </button>
        <button type="button" className="os-button" onClick={runFive} disabled={!canRun || thinking} title="Run J's last turn 5 times">
          Run 5×
        </button>
      </div>

      <div className="os-sbx-main">
        <aside className="os-sbx-sit" aria-label="Situation">
          <Field label="Workflow">
            <select className="os-sbx-in" disabled title="Workflows come later">
              <option>None yet</option>
            </select>
          </Field>
          <Field label="Goal">
            <select className="os-sbx-in" value={sit.goal} onChange={(e) => setSit({ ...sit, goal: e.target.value as Goal })}>
              <option value="book_call">Book a call</option>
              <option value="start_conversation">Start a conversation</option>
            </select>
          </Field>
          <Field label="Lead magnet">
            <select className="os-sbx-in" value={sit.leadMagnet} onChange={(e) => setSit({ ...sit, leadMagnet: e.target.value as LeadMagnet })}>
              <option value="hold">Hold</option>
              <option value="send_first">Send first</option>
              <option value="none">None</option>
            </select>
            {sit.leadMagnet !== "none" ? (
              <select className="os-sbx-in" aria-label="Which lead magnet" value={sit.resource} onChange={(e) => setSit({ ...sit, resource: e.target.value })}>
                {magnets.length ? null : <option value="">No resources</option>}
                {magnets.map((m) => (
                  <option key={m.slug} value={m.slug}>
                    {m.title}
                  </option>
                ))}
              </select>
            ) : null}
          </Field>
          <Field label="Came from">
            <select className="os-sbx-in" value={sit.entry} onChange={(e) => setSit({ ...sit, entry: e.target.value })} disabled={started}>
              <option value="">They DM&apos;d first</option>
              {entries.map((e) => (
                <option key={e.slug} value={e.slug}>
                  {e.keyword ? `Comment ${e.keyword}` : e.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="os-sbx-field">
            <span className="os-sbx-lab">
              Fake fields
              <button type="button" className="os-icon-btn" aria-label="Add fake field" title="Add field" onClick={() => setSit({ ...sit, fields: [...sit.fields, { key: "", value: "" }] })}>
                {icon(I_PLUS, 12)}
              </button>
            </span>
            {sit.fields.map((f, i) => (
              <div key={i} className="os-sbx-kv">
                <input aria-label="Field" placeholder="Field" value={f.key} onChange={(e) => setSit({ ...sit, fields: sit.fields.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) })} />
                <input aria-label={`${f.key || "Field"} value`} placeholder="—" value={f.value} onChange={(e) => setSit({ ...sit, fields: sit.fields.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
                <button type="button" className="os-icon-btn" aria-label="Remove field" onClick={() => setSit({ ...sit, fields: sit.fields.filter((_, j) => j !== i) })}>
                  {icon(I_X, 11)}
                </button>
              </div>
            ))}
          </div>
          <span className="os-sbx-sp" />
          <span className="os-sbx-note" title="Sandbox runs never count in test results and never sync to the CRM">
            Not counted · not synced
          </span>
        </aside>

        <div className="os-sbx-work">
          <div className="os-sbx-cols" data-side={side ? "true" : undefined}>
            {active.map((i) => (
              <ColumnView
                key={i}
                letter={i === 0 ? "A" : "B"}
                col={cols[i]}
                tests={tests}
                labels={labels}
                opener={opener}
                setterName={setterName}
                busy={busy[i] > 0}
                onPick={(exp, f) => setPick(i, exp, f)}
                onPage={(d) => page(i, d)}
                onTrace={openTrace}
              />
            ))}
          </div>
          <div className="os-sbx-compose" aria-label={`Message as ${lead}`}>
            {error ? (
              <p className="os-composer-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="os-sbx-compose-row">
              <textarea
                ref={inputRef}
                rows={1}
                value={text}
                aria-label={side ? "Write as the lead, sent to both lines" : "Write as the lead"}
                placeholder={`Write as ${lead}…`}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              {side ? <span className="os-sbx-chip">A + B</span> : null}
              <button type="button" className="os-button primary" onClick={send} disabled={!text.trim() || thinking}>
                Send
              </button>
            </div>
          </div>
        </div>

        {inspect ? <InspectDrawer view={inspect} onClose={() => setInspect(null)} /> : null}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="os-sbx-field">
      <span className="os-sbx-lab">{label}</span>
      {children}
    </div>
  );
}

interface ColumnProps {
  letter: "A" | "B";
  col: Column;
  tests: TestLine[];
  labels: Record<string, string>;
  opener: Entry | null;
  setterName: string;
  busy: boolean;
  onPick: (exp: string, f: Force) => void;
  onPage: (d: number) => void;
  onTrace: (run: Run) => void;
}

function ColumnView({ letter, col, tests, labels, opener, setterName, busy, onPick, onPage, onTrace }: ColumnProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const last = col.turns.at(-1);
  const pager = last && last.from === "setter" && last.runs.length > 1 ? last : null;

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "end" });
  }, [col.turns, busy]);

  return (
    <section className="os-sbx-col" aria-label={`Line ${letter}`}>
      <div className="os-sbx-colhead">
        <span className="os-sbx-letter">{letter}</span>
        {tests.map((t) => (
          <span key={t.experimentId} className="os-sbx-test">
            <span title={t.name}>{t.key.replace(/_/g, " ")}</span>
            <span className="os-segmented" role="group" aria-label={`${t.key.replace(/_/g, " ")} line`}>
              {(["A", "B", "random"] as Force[]).map((f) => (
                <button key={f} type="button" aria-pressed={(col.picks[t.experimentId] ?? "random") === f} onClick={() => onPick(t.experimentId, f)}>
                  {f === "random" ? "Random" : f}
                </button>
              ))}
            </span>
          </span>
        ))}
      </div>
      <ol className="os-messages os-sbx-thread" ref={listRef} aria-live="polite">
        {opener ? (
          <li className="me" data-opener="true">
            <div className="bubble">{opener.opener}</div>
            <time>{opener.keyword ? `Commented ${opener.keyword}` : "Opener"}</time>
          </li>
        ) : null}
        {col.turns.map((t, i) => {
          if (t.from === "lead")
            return (
              <li key={i} className="them">
                <div className="bubble">{t.text}</div>
              </li>
            );
          const run = t.runs[t.pick];
          if (!run) return null;
          const r = run.reply;
          const actions = (r.trace?.actions ?? []).filter((a) => a.status !== "rejected");
          const used = new Set(r.trace?.lines.used ?? []);
          return (
            <li key={i} className={r.hold ? "os-sandbox-hold" : "me"}>
              {r.hold ? <span>Holds: {r.holdReason}</span> : r.bubbles.map((b, j) => <div key={j} className="bubble">{b}</div>)}
              <span className="os-sbx-foot">
                {run.lines
                  .filter((l) => used.has(l.key))
                  .map((l) => (
                    <span key={l.key} className="os-sbx-chip">
                      {l.key.replace(/_/g, " ")} · {labels[l.variantId] ?? "?"}
                    </span>
                  ))}
                {actions.map((a, j) => (
                  <span key={j} className="os-sbx-chip" data-dry="true" title="Dry: shown in the trace, never executed">
                    {a.name.replace(/_/g, " ")}
                    <em> · dry</em>
                  </span>
                ))}
                {r.booked ? (
                  <span className="os-sbx-chip" data-bad={!r.booked.ok || undefined} title={r.booked.error}>
                    {r.booked.ok ? "Booked for real" : "Not booked"}
                  </span>
                ) : null}
                <button type="button" className="os-sbx-trace" onClick={() => onTrace(run)}>
                  Trace
                </button>
                <SetterMark name={setterName} size={16} title={`Sent by ${setterName}`} />
              </span>
            </li>
          );
        })}
        {busy ? (
          <li className="me" aria-label={`${setterName} is writing`}>
            <div className="bubble os-sandbox-typing">
              <span className="os-draft-dot" />
              <span className="os-draft-dot" />
              <span className="os-draft-dot" />
            </div>
          </li>
        ) : null}
      </ol>
      <div className="os-sbx-colfoot">
        {pager ? (
          <span className="os-sbx-pager" aria-label={`Run ${pager.pick + 1} of ${pager.runs.length}`}>
            <button type="button" className="os-icon-btn" aria-label="Previous run" onClick={() => onPage(-1)}>
              {icon(I_LEFT, 12)}
            </button>
            {pager.pick + 1}/{pager.runs.length}
            <button type="button" className="os-icon-btn" aria-label="Next run" onClick={() => onPage(1)}>
              {icon(I_RIGHT, 12)}
            </button>
          </span>
        ) : null}
      </div>
    </section>
  );
}
