"use client";

// A setter file (System prompt.md, Offers.md…) edited like a doc. The page is
// rendered Markdown; click a block to edit its Markdown in place. Raw shows the
// whole file. Saves itself a moment after you stop typing; History keeps one
// entry per editing session. No editor dependency.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { restoreRevision, saveDoc } from "@/app/(os)/os/knowledge/actions";
import { KbIcon } from "@/components/os/knowledge/icons";
import { InfoTip } from "@/components/os/ui";
import type { DocRevisionView } from "@/lib/os/setter/knowledge/doc-store";
import type { CorrectionPair } from "@/lib/os/setter/knowledge/corrections";
import { DOC_FILES, type DocKey } from "@/lib/os/setter/knowledge/docs";
import { applyFormat, joinBlocks, renderBlock, splitBlocks, type MdBlock } from "@/lib/os/setter/knowledge/markdown";

const AUTOSAVE_MS = 900;

type SaveState = { kind: "saved"; at: string | null } | { kind: "saving" } | { kind: "dirty" } | { kind: "error"; text: string };

export function ago(iso: string | null, now: number): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function authorLabel(a: string | null): string {
  if (!a) return "Edited";
  if (a === "import") return "Imported";
  if (a === "seed") return "Sample";
  if (a === "copy" || a.startsWith("copied from")) return a === "copy" ? "Copied" : a.replace(/^copied/, "Copied");
  if (a.endsWith("(restored)")) return "Restored";
  return "You edited";
}

interface DocEditorProps {
  setterId: string;
  setterName: string;
  docKey: DocKey;
  initialBody: string;
  updatedAt: string | null;
  revisions: DocRevisionView[];
  corrections: CorrectionPair[];
  correctionsTotal: number;
}

export default function DocEditor(props: DocEditorProps) {
  const { setterId, docKey } = props;
  const meta = DOC_FILES[docKey];
  const [body, setBody] = useState(props.initialBody);
  const [raw, setRaw] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [state, setState] = useState<SaveState>({ kind: "saved", at: props.updatedAt });
  const [revisions, setRevisions] = useState(props.revisions);
  const [now, setNow] = useState(() => Date.now());
  const saved = useRef(props.initialBody);
  const active = useRef<HTMLTextAreaElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const flush = useCallback(
    async (next: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (next === saved.current) return;
      setState({ kind: "saving" });
      const r = await saveDoc(setterId, docKey, next);
      if (r.error) {
        setState({ kind: "error", text: r.error });
        return;
      }
      saved.current = next;
      const at = r.savedAt ?? new Date().toISOString();
      setNow(Date.now());
      setState({ kind: "saved", at });
      setRevisions((list) => {
        const head = list[0];
        const fresh = head && authorLabel(head.author) === "You edited" && Date.now() - new Date(head.at).getTime() < 10 * 60_000;
        return fresh ? [{ ...head, at }, ...list.slice(1)] : [{ id: `local-${at}`, author: "you", at }, ...list];
      });
    },
    [setterId, docKey]
  );

  const change = (next: string) => {
    setBody(next);
    setState({ kind: "dirty" });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(next), AUTOSAVE_MS);
  };

  // Leaving with unsaved text: save it, and warn if the save can't finish.
  const bodyRef = useRef(body);
  useEffect(() => {
    bodyRef.current = body;
  }, [body]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (bodyRef.current !== saved.current) {
        void flush(bodyRef.current);
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      if (bodyRef.current !== saved.current) void flush(bodyRef.current);
    };
  }, [flush]);

  const blocks = useMemo(() => splitBlocks(body), [body]);

  const setBlock = (i: number, raw: string) => {
    const text = raw.replace(/\u200b/g, "") || raw;
    const next: MdBlock[] = blocks.map((b, j) => (j === i ? { ...b, text } : b));
    change(joinBlocks(next));
  };

  const addBlock = () => {
    if (timer.current) void flush(body);
    const trimmed = body.replace(/\s+$/, "");
    // A placeholder char so the new block exists; it goes again on blur.
    const next = (trimmed ? `${trimmed}\n\n` : "") + "​";
    setBody(next);
    setEditing(splitBlocks(next).length - 1);
  };

  const format = (kind: "heading" | "bold" | "list" | "link") => {
    const el = active.current;
    if (!el) return;
    const out = applyFormat(kind, { text: el.value, selStart: el.selectionStart, selEnd: el.selectionEnd });
    if (raw) change(out.text);
    else if (editing !== null) setBlock(editing, out.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(out.selStart, out.selEnd);
    });
  };

  const status =
    state.kind === "saving"
      ? "Saving…"
      : state.kind === "dirty"
        ? "Editing"
        : state.kind === "error"
          ? state.text
          : state.at
            ? `Saved · ${ago(state.at, now)}`
            : "Not saved yet";

  return (
    <div className="kb-docwrap">
      <section aria-label={meta.file} className="kb-doc-pane">
        <div className="kb-doc-bar">
          <span className="kb-doc-name">{meta.file}</span>
          <span className="kb-saved" role="status" data-kind={state.kind}>
            <span className="kb-saved-dot" aria-hidden="true" />
            {status}
          </span>
          <div className="kb-grow" />
          <div role="group" aria-label="Formatting" className="kb-fmt">
            <button type="button" aria-label="Heading" onMouseDown={(e) => e.preventDefault()} onClick={() => format("heading")} disabled={!raw && editing === null}>
              H
            </button>
            <button type="button" aria-label="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => format("bold")} disabled={!raw && editing === null}>
              B
            </button>
            <button type="button" aria-label="Bulleted list" onMouseDown={(e) => e.preventDefault()} onClick={() => format("list")} disabled={!raw && editing === null}>
              <KbIcon name="list" />
            </button>
            <button type="button" aria-label="Link" onMouseDown={(e) => e.preventDefault()} onClick={() => format("link")} disabled={!raw && editing === null}>
              <KbIcon name="link" />
            </button>
          </div>
          <button type="button" className="kb-raw" aria-pressed={raw} onClick={() => {
            setEditing(null);
            setRaw(!raw);
          }}>
            Raw
          </button>
        </div>

        {raw ? (
          <textarea
            className="kb-rawarea"
            aria-label={`${meta.file} (Markdown)`}
            value={body}
            spellCheck
            onFocus={(e) => (active.current = e.currentTarget)}
            onChange={(e) => change(e.target.value)}
            onBlur={() => void flush(body)}
          />
        ) : (
          <article className="kb-doc" aria-label={`${meta.file} editor`}>
            {blocks.map((b, i) =>
              !b.text ? null : editing === i ? (
                <BlockInput
                  key={i}
                  value={b.text}
                  onFocus={(el) => (active.current = el)}
                  onChange={(t) => setBlock(i, t)}
                  onDone={(t) => {
                    setEditing(null);
                    const clean = t.replace(/​/g, "");
                    let next = clean.trim()
                      ? joinBlocks(blocks.map((x, j) => (j === i ? { ...x, text: clean } : x)))
                      : joinBlocks(blocks.filter((_, j) => j !== i)).trimEnd() + "\n";
                    // Only whitespace changed (an empty "Write here"): keep what was saved.
                    if (next.trim() === saved.current.trim()) next = saved.current;
                    setBody(next);
                    void flush(next);
                    if (next === saved.current) setState((s) => (s.kind === "dirty" ? { kind: "saved", at: props.updatedAt } : s));
                  }}
                />
              ) : (
                <div
                  key={i}
                  className="kb-block"
                  role="button"
                  tabIndex={0}
                  aria-label="Edit this part"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a")) return;
                    setEditing(i);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      setEditing(i);
                    }
                  }}
                  dangerouslySetInnerHTML={{ __html: renderBlock(b.text) || "&nbsp;" }}
                />
              )
            )}
            <button type="button" className="kb-addblock" onClick={addBlock}>
              <KbIcon name="plus" size={12} />
              Write here
            </button>
          </article>
        )}
      </section>

      <aside aria-label="Helper" className="kb-helper">
        <div className="kb-helper-row">
          <span className="kb-helper-h">Used by {props.setterName} when…</span>
          <InfoTip label={`When ${props.setterName} reads ${meta.file}`}>{meta.usedWhen}</InfoTip>
        </div>
        <div className="kb-helper-col">
          <div className="kb-helper-row">
            <span className="kb-helper-h">Recent voice corrections</span>
            <Link href="?s=corrections" className="kb-quiet">
              All {props.correctionsTotal}
            </Link>
          </div>
          {props.corrections.length ? (
            <ul className="kb-corr">
              {props.corrections.map((c, i) => (
                <li key={i}>
                  {c.wrote && <s>{c.wrote}</s>}
                  {c.sent && <span>{c.sent}</span>}
                  {c.who && <span className="kb-corr-who">{c.who}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <span className="kb-quiet">None yet</span>
          )}
        </div>
        <History setterId={setterId} revisions={revisions} now={now} onRestore={(b) => {
          saved.current = b;
          setBody(b);
          setEditing(null);
          setState({ kind: "saved", at: new Date().toISOString() });
          setRevisions((list) => [{ id: `local-r-${Date.now()}`, author: "(restored)", at: new Date().toISOString() }, ...list]);
        }} />
      </aside>
    </div>
  );
}

function BlockInput({ value, onChange, onDone, onFocus }: { value: string; onChange: (t: string) => void; onDone: (t: string) => void; onFocus: (el: HTMLTextAreaElement) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const end = el.value.replace(/​/g, "").length;
    el.setSelectionRange(end, end);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      className="kb-blockinput"
      aria-label="Markdown"
      value={value}
      onFocus={(e) => onFocus(e.currentTarget)}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => onDone(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") e.currentTarget.blur();
      }}
    />
  );
}

function History({ setterId, revisions, now, onRestore }: { setterId: string; revisions: DocRevisionView[]; now: number; onRestore: (body: string) => void }) {
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="kb-helper-col kb-history">
      <span className="kb-helper-h">History</span>
      {revisions.slice(0, 8).map((r, i) => (
        <div key={r.id} className="kb-hist-row">
          {i > 0 && !r.id.startsWith("local") ? (
            asking === r.id ? (
              <button
                type="button"
                className="kb-hist-restore"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const res = await restoreRevision(setterId, r.id);
                  setBusy(false);
                  setAsking(null);
                  if (res.error || res.body === undefined) setError(res.error ?? "Couldn't restore it.");
                  else onRestore(res.body);
                }}
              >
                {busy ? "Restoring…" : "Restore this version"}
              </button>
            ) : (
              <button type="button" className="kb-hist-btn" onClick={() => setAsking(r.id)} title="Restore this version">
                {authorLabel(r.author)}
              </button>
            )
          ) : (
            <span>{authorLabel(r.author)}</span>
          )}
          <span className="kb-quiet">{ago(r.at, now)}</span>
        </div>
      ))}
      {error && <span className="kb-err">{error}</span>}
    </div>
  );
}
