"use client";

// A setter file (System prompt.md, Offers.md…) edited like a doc: a TipTap
// rich editor (loaded on demand) over Markdown storage. Raw shows the whole
// file. Saves itself a moment after you stop typing; History keeps one entry
// per editing session.

import type { Editor } from "@tiptap/core";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { restoreRevision, saveDoc } from "@/app/(os)/os/knowledge/actions";
import { KbIcon } from "@/components/os/knowledge/icons";
import { InfoTip } from "@/components/os/ui";
import type { DocRevisionView } from "@/lib/os/setter/knowledge/doc-store";
import type { CorrectionPair } from "@/lib/os/setter/knowledge/corrections";
import { DOC_FILES, type DocKey } from "@/lib/os/setter/knowledge/docs";
import { applyFormat, renderMarkdown } from "@/lib/os/setter/knowledge/markdown";

const RichDoc = dynamic(() => import("@/components/os/knowledge/rich-doc"), { ssr: false });

const AUTOSAVE_MS = 900;

type SaveState = { kind: "saved"; at: string | null } | { kind: "saving" } | { kind: "dirty" } | { kind: "error"; text: string };
type FormatKind = "heading" | "bold" | "list" | "link";

/** The toolbar on the rich editor. */
function formatRich(ed: Editor, kind: FormatKind) {
  const c = ed.chain().focus();
  if (kind === "heading") c.toggleHeading({ level: 2 }).run();
  else if (kind === "bold") c.toggleBold().run();
  else if (kind === "list") c.toggleBulletList().run();
  else if (ed.isActive("link")) c.extendMarkRange("link").unsetLink().run();
  else {
    const url = window.prompt("Link", "https://")?.trim();
    if (!url || url === "https://") return;
    const href = /^(https?:\/\/|mailto:)/i.test(url) ? url : `https://${url}`;
    if (ed.state.selection.empty) c.insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run();
    else c.extendMarkRange("link").setLink({ href }).run();
  }
}

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
  if (a === "Setter chat") return "Setter chat";
  if (a === "New setter") return "Created";
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
  const [editor, setEditor] = useState<Editor | null>(null);
  const [state, setState] = useState<SaveState>({ kind: "saved", at: props.updatedAt });
  const [revisions, setRevisions] = useState(props.revisions);
  const [now, setNow] = useState(() => Date.now());
  const [initial, setInitial] = useState(props.initialBody);
  const saved = useRef(props.initialBody);
  const active = useRef<HTMLTextAreaElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A new body from the server (saved elsewhere): show it, unless we have
  // unsaved edits or it's just our own save coming back.
  if (props.initialBody !== initial) {
    setInitial(props.initialBody);
    if (props.initialBody !== body && state.kind === "saved") setBody(props.initialBody);
  }

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const bodyRef = useRef(body);
  const inFlight = useRef(false);
  const lastAt = useRef(props.updatedAt);

  const flush = useCallback(
    async (first: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      // One save at a time; whatever changed meanwhile goes right after.
      if (inFlight.current) return;
      let next = first;
      while (next !== saved.current) {
        inFlight.current = true;
        setState({ kind: "saving" });
        const r = await saveDoc(setterId, docKey, next).catch(() => ({ error: "Couldn't save. Check your connection.", savedAt: undefined }));
        inFlight.current = false;
        if (r.error) {
          setState({ kind: "error", text: r.error });
          return;
        }
        saved.current = next;
        const at = r.savedAt ?? new Date().toISOString();
        lastAt.current = at;
        setNow(Date.now());
        setRevisions((list) => {
          const head = list[0];
          const fresh = head && authorLabel(head.author) === "You edited" && Date.now() - new Date(head.at).getTime() < 10 * 60_000;
          return fresh ? [{ ...head, at }, ...list.slice(1)] : [{ id: `local-${at}`, author: "you", at }, ...list];
        });
        next = bodyRef.current;
      }
      setState((s) => (s.kind === "dirty" || s.kind === "saving" ? { kind: "saved", at: lastAt.current } : s));
    },
    [setterId, docKey]
  );

  const change = useCallback(
    (next: string) => {
      setBody(next);
      setState({ kind: "dirty" });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(next), AUTOSAVE_MS);
    },
    [flush]
  );

  // Leaving with unsaved text: save it, and warn if the save can't finish.
  useEffect(() => {
    bodyRef.current = body;
  }, [body]);
  const initialBody = props.initialBody;
  useEffect(() => {
    if (bodyRef.current === initialBody) saved.current = initialBody;
  }, [initialBody]);
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

  const format = (kind: FormatKind) => {
    if (!raw) {
      if (editor) formatRich(editor, kind);
      return;
    }
    const el = active.current;
    if (!el) return;
    const out = applyFormat(kind, { text: el.value, selStart: el.selectionStart, selEnd: el.selectionEnd });
    change(out.text);
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

  const off = !raw && !editor;
  const fmtBtn = (kind: FormatKind, label: string, icon: React.ReactNode) => (
    <button type="button" aria-label={label} onMouseDown={(e) => e.preventDefault()} onClick={() => format(kind)} disabled={off}>
      {icon}
    </button>
  );

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
            {fmtBtn("heading", "Heading", "H")}
            {fmtBtn("bold", "Bold", "B")}
            {fmtBtn("list", "Bulleted list", <KbIcon name="list" />)}
            {fmtBtn("link", "Link", <KbIcon name="link" />)}
          </div>
          <button type="button" className="kb-raw" aria-pressed={raw} onClick={() => setRaw(!raw)}>
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
          <>
            <RichDoc markdown={body} label={`${meta.file} editor`} onChange={change} onBlur={() => void flush(bodyRef.current)} onEditor={setEditor} />
            {!editor && <article className="kb-doc kb-rich" aria-busy="true" dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />}
          </>
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
          if (timer.current) clearTimeout(timer.current);
          timer.current = null;
          setState({ kind: "saved", at: new Date().toISOString() });
          setRevisions((list) => [{ id: `local-r-${Date.now()}`, author: "(restored)", at: new Date().toISOString() }, ...list]);
        }} />
      </aside>
    </div>
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
