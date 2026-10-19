"use client";

// "J's brain" (JBrain board): what J saw and did for one draft. Context ·
// Prompt · Tools · Trace · Result, each collapsible. Esc closes.

import Link from "next/link";
import { useEffect, useState } from "react";
import { inspectDraft } from "@/app/(os)/os/inbox/inspect-actions";
import { fmtCost, fmtMs, fmtTokens, shortModel, type InspectView } from "@/lib/os/setter/inspect/view";

const P = {
  code: "M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5",
  copy: "M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3",
  play: "M5 3.5v9l7-4.5-7-4.5Z",
  x: "M4 4l8 8M12 4l-8 8",
  down: "m4 6 4 4 4-4",
  right: "M6 3.5 10.5 8 6 12.5",
};

const Icon = ({ d, size = 14 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const timeOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
};

interface DrawerProps {
  /** Load this draft's trace… */
  draftId?: string;
  /** …or show this view (the sandbox builds it in the browser). */
  view?: InspectView | null;
  onClose: () => void;
  sandboxHref?: string;
}

export default function InspectDrawer({ draftId, view: given = null, onClose, sandboxHref }: DrawerProps) {
  const [loaded, setLoaded] = useState<{ id: string; view: InspectView | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!draftId) return;
    let live = true;
    inspectDraft(draftId)
      .then((r) => live && setLoaded({ id: draftId, view: "view" in r ? r.view : null, error: "error" in r ? r.error : null }))
      .catch(() => live && setLoaded({ id: draftId, view: null, error: "Couldn't load the trace." }));
    return () => {
      live = false;
    };
  }, [draftId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[role=dialog][aria-modal=true]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const mine = draftId && loaded?.id === draftId ? loaded : null;
  const view = given ?? mine?.view ?? null;
  const error = given ? null : (mine?.error ?? null);

  return (
    <aside className="os-insp" aria-label="Inspect draft">
      <header className="os-insp-head">
        <Icon d={P.code} size={15} />
        <h2>Inspect</h2>
        {view ? (
          <span className="os-insp-meta">
            {view.source} · {timeOf(view.at)}
          </span>
        ) : null}
        <span className="os-insp-sp" />
        {view ? (
          <button type="button" className="os-icon-btn" aria-label="Copy as JSON" title="Copy as JSON" onClick={() => navigator.clipboard?.writeText(JSON.stringify(view.raw ?? view, null, 2)).catch(() => {})}>
            <Icon d={P.copy} />
          </button>
        ) : null}
        {sandboxHref ? (
          <Link className="os-icon-btn" href={sandboxHref} aria-label="Open in sandbox" title="Open in sandbox">
            <Icon d={P.play} />
          </Link>
        ) : null}
        <button type="button" className="os-icon-btn" aria-label="Close inspect" title="Close (Esc)" onClick={onClose}>
          <Icon d={P.x} />
        </button>
      </header>
      <div className="os-insp-body">
        {error ? <p className="os-insp-note">{error}</p> : !view ? <p className="os-insp-note" aria-busy="true">Loading…</p> : <InspectBody view={view} />}
      </div>
    </aside>
  );
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <details className="os-insp-sec" open>
      <summary>
        <span className="os-insp-chev">
          <Icon d={P.down} size={12} />
        </span>
        {title}
        <span className="os-insp-sp" />
        {right != null ? <span className="os-insp-right">{right}</span> : null}
      </summary>
      <div className="os-insp-in">{children}</div>
    </details>
  );
}

export function InspectBody({ view }: { view: InspectView }) {
  const c = view.context;
  const rows: [string, React.ReactNode][] = [];
  if (c.workflow) rows.push(["Workflow", c.workflow]);
  if (c.step) rows.push(["Step", c.step]);
  if (c.goal) rows.push(["Goal", c.goal]);
  if (c.hold) rows.push(["Hold", c.hold]);
  if (c.lines.length)
    rows.push([
      "Lines",
      <span className="os-insp-chips" key="l">
        {c.lines.map((l) => (
          <span key={l.key} className="os-insp-chip" title={l.text}>
            {l.key.replace(/_/g, " ")}
            {l.variant ? ` · ${l.variant}` : ""}
          </span>
        ))}
      </span>,
    ]);
  if (c.window) rows.push(["Window", c.window]);
  if (c.stage) rows.push(["Stage", c.stage]);
  const r = view.result;
  const used = view.tools?.filter((t) => t.used).length ?? 0;

  return (
    <>
      {view.legacy ? <p className="os-insp-note">No trace: written by J without tools.</p> : null}
      {rows.length ? (
        <Section title="Context">
          <dl className="os-insp-ctx">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ) : null}
      {view.prompt ? <PromptSection prompt={view.prompt} /> : null}
      {view.tools ? (
        <Section title="Tools" right={`${used} / ${view.tools.length}`}>
          <div className="os-insp-chips">
            {view.tools.map((t) => (
              <span key={t.name} className="os-insp-tool" data-used={t.used || undefined} data-kind={t.kind} title={t.used ? "Used this turn" : "Offered"}>
                {t.name}
              </span>
            ))}
          </div>
        </Section>
      ) : null}
      {view.calls ? (
        <Section title="Trace" right={fmtMs(r.ms)}>
          {view.calls.length ? (
            <ol className="os-insp-calls">
              {view.calls.map((call) => (
                <li key={call.n}>
                  <details>
                    <summary>
                      <span className="os-insp-n">{call.n}</span>
                      <span className="os-insp-call">
                        <code>{call.name}</code>
                        {call.args ? <span className="os-insp-args">{call.args}</span> : null}
                      </span>
                      <span className="os-insp-out" data-bad={!call.ok || undefined}>
                        {call.kind === "action" && call.ok ? (view.source === "sandbox" ? "dry" : "queued") : call.kind === "reply" && call.ok ? "end" : call.summary}
                      </span>
                      <span className="os-insp-ms">{call.ms == null ? "—" : fmtMs(call.ms)}</span>
                    </summary>
                    <pre className="os-insp-pre">{JSON.stringify({ input: call.input, ...(call.output !== undefined ? { output: call.output } : {}), ...(call.ok ? {} : { error: call.summary }) }, null, 2)}</pre>
                  </details>
                </li>
              ))}
            </ol>
          ) : (
            <p className="os-insp-note">No tool calls.</p>
          )}
        </Section>
      ) : null}
      <Section title="Result">
        {r.actions.length ? (
          <div className="os-insp-chips">
            {r.actions.map((a, i) => (
              <span key={i} className="os-insp-act" data-status={a.status} title={a.reason ?? a.status}>
                {a.label}
                {a.status !== "queued" ? <em> · {a.status}</em> : null}
              </span>
            ))}
          </div>
        ) : null}
        {r.hold ? <p className="os-insp-note">Hold: says nothing.</p> : null}
        {r.linesUsed.length ? (
          <div className="os-insp-kv">
            <span>Lines used</span>
            <span>{r.linesUsed.map((l) => l.replace(/_/g, " ")).join(", ")}</span>
          </div>
        ) : null}
        <div className="os-insp-stats">
          <span>
            <small>Model</small>
            {shortModel(r.model) ?? r.backend ?? "—"}
          </span>
          <span>
            <small>In / out</small>
            {r.tokensIn == null ? "—" : `${fmtTokens(r.tokensIn)}${r.cached ? ` (${fmtTokens(r.cached)} cached)` : ""} / ${fmtTokens(r.tokensOut)}`}
          </span>
          <span>
            <small>Cost</small>
            {fmtCost(r.cost)}
          </span>
          <span>
            <small>Time</small>
            {fmtMs(r.ms)}
          </span>
        </div>
        {r.reasoning ? <p className="os-insp-why">{r.reasoning}</p> : null}
        {view.notes.length ? (
          <ul className="os-insp-notes">
            {view.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        ) : null}
      </Section>
    </>
  );
}

function PromptSection({ prompt }: { prompt: NonNullable<InspectView["prompt"]> }) {
  const [open, setOpen] = useState<string | null>(null);
  const shown = prompt.groups.find((g) => g.name === open);
  return (
    <Section title="Prompt" right={fmtTokens(prompt.tokens)}>
      <div className="os-insp-groups">
        {prompt.groups.map((g) => (
          <button key={g.name} type="button" aria-expanded={open === g.name} onClick={() => setOpen(open === g.name ? null : g.name)}>
            <Icon d={open === g.name ? P.down : P.right} size={11} />
            <span>{g.name}</span>
            <span className="os-insp-tok">{fmtTokens(g.tokens)}</span>
          </button>
        ))}
      </div>
      {shown ? (
        <pre className="os-insp-pre" aria-label={`${shown.name} text`}>
          {shown.text}
        </pre>
      ) : null}
    </Section>
  );
}
