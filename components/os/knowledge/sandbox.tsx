"use client";

// "Test this setter": you write as the lead, J answers with this knowledge
// base and the real drafter. The chat lives in this tab only (sessionStorage);
// nothing is sent to Instagram or saved as a contact or draft.

import { useEffect, useRef, useState, useTransition } from "react";
import { runSandbox } from "@/app/(os)/os/knowledge/actions";
import type { SandboxTurn } from "@/lib/os/setter/sandbox";

interface Entry {
  slug: string;
  name: string;
  opener: string;
}

interface Meta {
  stage: string | null;
  reasoning: string | null;
  flags: string[];
  backend: string;
  hold: string | null;
}

interface Turn extends SandboxTurn {
  meta?: Meta;
}

interface Saved {
  entry: string;
  turns: Turn[];
}

function load(key: string): Saved | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

export default function Sandbox({ setterId, setterName, entries, backend }: { setterId: string; setterName: string; entries: Entry[]; backend: string }) {
  const key = `os-sandbox:${setterId}`;
  const [entry, setEntry] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [thinking, start] = useTransition();
  const listRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Restore after mount (sessionStorage isn't there during the server render).
  useEffect(() => {
    const saved = load(key);
    if (!saved) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from sessionStorage
    setEntry(saved.entry);
    setTurns(saved.turns);
  }, [key]);

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify({ entry, turns } satisfies Saved));
    } catch {
      // private mode: the chat just won't survive a reload
    }
    listRef.current?.lastElementChild?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [key, entry, turns, thinking]);

  const opener = entries.find((e) => e.slug === entry)?.opener ?? null;

  function ask(history: Turn[]) {
    setError(null);
    start(async () => {
      const r = await runSandbox(
        setterId,
        history.map(({ from, text: t }) => ({ from, text: t })),
        entry || null
      );
      if (r.error || !r.reply) {
        setError(r.error ?? "J couldn't answer.");
        return;
      }
      const rep = r.reply;
      const meta: Meta = { stage: rep.stage, reasoning: rep.reasoning, flags: rep.flags, backend: rep.usage.backend, hold: rep.hold ? rep.holdReason : null };
      if (rep.hold) setTurns([...history, { from: "setter", text: "", meta }]);
      else setTurns([...history, ...rep.bubbles.map((b, i) => ({ from: "setter" as const, text: b, ...(i === rep.bubbles.length - 1 ? { meta } : {}) }))]);
    });
  }

  function send() {
    const t = text.trim();
    if (!t || thinking) return;
    const next = [...turns, { from: "lead" as const, text: t }];
    setTurns(next);
    setText("");
    ask(next);
  }

  /** Drop J's last answer and ask again. */
  function regenerate() {
    let i = turns.length;
    while (i > 0 && turns[i - 1].from === "setter") i--;
    const history = turns.slice(0, i);
    setTurns(history);
    ask(history);
  }

  function reset() {
    setTurns([]);
    setError(null);
    inputRef.current?.focus();
  }

  const lastIsJ = turns.length > 0 && turns[turns.length - 1].from === "setter";

  return (
    <div className="os-sandbox">
      <div className="os-sandbox-bar">
        <label className="os-select">
          <span className="sr-only">How they arrived</span>
          <select value={entry} onChange={(e) => setEntry(e.target.value)} disabled={turns.length > 0}>
            <option value="">They DM&apos;d first</option>
            {entries.map((e) => (
              <option key={e.slug} value={e.slug}>
                Came in via {e.name}
              </option>
            ))}
          </select>
        </label>
        <span className="os-sandbox-note">
          You&apos;re the lead. {setterName} answers{backend === "fake" ? " with sample replies (no model key on this deploy)" : ""}. Nothing goes to Instagram.
        </span>
        <button type="button" className="os-button ghost" onClick={reset} disabled={!turns.length || thinking}>
          Start over
        </button>
      </div>

      <ol className="os-messages os-sandbox-thread" ref={listRef} aria-live="polite">
        {!turns.length && !opener && <li className="os-sandbox-empty">Write the first message the way a lead would.</li>}
        {opener && (
          <li className="me" data-opener="true">
            <div className="bubble">{opener}</div>
            <time>Opener, sent by the campaign</time>
          </li>
        )}
        {turns.map((t, i) =>
          t.from === "lead" ? (
            <li key={i} className="them">
              <div className="bubble">{t.text}</div>
            </li>
          ) : t.meta?.hold ? (
            <li key={i} className="os-sandbox-hold">
              J would say nothing here: {t.meta.hold}
              <MetaLine meta={t.meta} />
            </li>
          ) : (
            <li key={i} className="me">
              <div className="bubble">{t.text}</div>
              {t.meta && <MetaLine meta={t.meta} />}
            </li>
          )
        )}
        {thinking && (
          <li className="me" aria-label="J is writing">
            <div className="bubble os-sandbox-typing">
              <span className="os-draft-dot" />
              <span className="os-draft-dot" />
              <span className="os-draft-dot" />
            </div>
          </li>
        )}
      </ol>

      <div className="os-composer">
        {error && <p className="os-composer-error">{error}</p>}
        <label className="sr-only" htmlFor="os-sandbox-input">
          Message as the lead
        </label>
        <textarea
          id="os-sandbox-input"
          ref={inputRef}
          rows={2}
          value={text}
          placeholder="Message as the lead…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="os-composer-actions">
          {lastIsJ && (
            <button type="button" className="os-button ghost" onClick={regenerate} disabled={thinking}>
              Try again
            </button>
          )}
          <button type="button" className="os-button primary" onClick={send} disabled={!text.trim() || thinking}>
            {thinking ? "J is writing…" : "Send as lead"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MetaLine({ meta }: { meta: Meta }) {
  return (
    <details className="os-sandbox-meta">
      <summary>
        {meta.stage && <span className="chip quiet">{meta.stage}</span>}
        {meta.flags.map((f) => (
          <span key={f} className={`chip ${f === "sample" ? "quiet" : "flag"}`}>
            {f}
          </span>
        ))}
        <span>Why</span>
      </summary>
      <p>{meta.reasoning || "No reasoning given."}</p>
    </details>
  );
}
