"use client";

// Setter chat: a push panel on the right of the setter page (like the
// Contacts panel), toggled from the header. Kevin types a change in plain
// words; the assistant answers and proposes per-doc edits with Apply/Discard.
// Apply saves through the doc path (History: "Setter chat").

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, useTransition } from "react";
import {
  applySetterChatEdit,
  clearSetterChat,
  discardSetterChatEdit,
  loadSetterChat,
  sendSetterChat,
} from "@/app/(os)/os/knowledge/chat-actions";
import { KbIcon } from "@/components/os/knowledge/icons";
import type { ChatEdit } from "@/lib/os/setter/chat/assistant";
import { lineDiff } from "@/lib/os/setter/chat/diff";
import type { ChatMessageView } from "@/lib/os/setter/chat/store";
import { DOC_FILES } from "@/lib/os/setter/knowledge/docs";

const KEY = "os.kb.chat";

interface Ctx {
  open: boolean;
  setOpen: (v: boolean) => void;
  setterId: string;
  setterName: string;
}

const ChatCtx = createContext<Ctx | null>(null);

export function SetterChatProvider({ setterId, setterName, children }: { setterId: string; setterName: string; children: React.ReactNode }) {
  const [open, setOpenState] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) === "1") setOpenState(true);
    } catch {
      // storage blocked: start closed
    }
  }, []);
  const setOpen = (v: boolean) => {
    setOpenState(v);
    try {
      localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      // fine
    }
  };
  return <ChatCtx.Provider value={{ open, setOpen, setterId, setterName }}>{children}</ChatCtx.Provider>;
}

/** The header button. Renders nothing outside a setter page. */
export function SetterChatToggle() {
  const c = useContext(ChatCtx);
  if (!c) return null;
  return (
    <button type="button" className="kb-btn" aria-pressed={c.open} aria-controls="kb-chat" onClick={() => c.setOpen(!c.open)}>
      <KbIcon name="chat" />
      Chat
    </button>
  );
}

export function SetterChatPanel() {
  const c = useContext(ChatCtx);
  if (!c?.open) return null;
  return <Panel ctx={c} />;
}

function Panel({ ctx }: { ctx: Ctx }) {
  const { setterId, setterName } = ctx;
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessageView[] | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startRefresh] = useTransition();
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let live = true;
    loadSetterChat(setterId).then((r) => {
      if (!live) return;
      if (r.error) setError(r.error);
      setMessages(r.messages ?? []);
    });
    input.current?.focus({ preventScroll: true });
    return () => {
      live = false;
    };
  }, [setterId]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages, busy]);

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    setText("");
    const optimistic: ChatMessageView = { id: `local-${Date.now()}`, role: "user", text: t, edits: [], test: null, at: new Date().toISOString() };
    setMessages((m) => [...(m ?? []), optimistic]);
    const r = await sendSetterChat(setterId, t);
    setBusy(false);
    setMessages((m) => [...(m ?? []).filter((x) => x.id !== optimistic.id), ...(r.messages ?? [])]);
    if (r.error) {
      setError(r.error);
      if (!r.messages?.length) setText(t);
    }
  };

  const setEdits = (messageId: string, edits: ChatEdit[]) => setMessages((m) => (m ?? []).map((x) => (x.id === messageId ? { ...x, edits } : x)));

  const act = async (messageId: string, editId: string, kind: "apply" | "discard") => {
    setError(null);
    const r = kind === "apply" ? await applySetterChatEdit(setterId, messageId, editId) : await discardSetterChatEdit(setterId, messageId, editId);
    if (r.edits) setEdits(messageId, r.edits);
    if (r.error) setError(r.error);
    else if (kind === "apply") startRefresh(() => router.refresh());
  };

  return (
    <aside id="kb-chat" className="kb-chat" aria-label={`Chat about ${setterName}`}>
      <div className="kb-chat-head">
        <span className="kb-chat-title">Chat</span>
        <div className="kb-grow" />
        {Boolean(messages?.length) && (
          <button
            type="button"
            className="kb-chat-clear"
            onClick={async () => {
              const r = await clearSetterChat(setterId);
              if (r.error) setError(r.error);
              else setMessages([]);
            }}
          >
            Clear
          </button>
        )}
        <button type="button" className="kb-chat-x" aria-label="Close chat" onClick={() => ctx.setOpen(false)}>
          <KbIcon name="x" />
        </button>
      </div>

      <div className="kb-chat-list" ref={list} aria-live="polite">
        {messages === null ? (
          <span className="kb-quiet">Loading…</span>
        ) : messages.length === 0 ? (
          <div className="kb-chat-empty">
            <span>Tell {setterName} what to change.</span>
            {["Stop asking about revenue so early", "Add the 7-day sprint offer", "Test: “hey, saw your reel”"].map((s) => (
              <button key={s} type="button" className="kb-chat-hint" onClick={() => setText(s.replace(/[“”]/g, '"'))}>
                {s}
              </button>
            ))}
          </div>
        ) : (
          messages.map((m) => <Message key={m.id} m={m} onAct={act} />)
        )}
        {busy && <span className="kb-chat-typing">Thinking…</span>}
      </div>

      {error && (
        <p className="kb-err kb-chat-err" role="alert">
          {error}
        </p>
      )}

      <form
        className="kb-chat-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          ref={input}
          rows={2}
          aria-label="Message"
          placeholder="What should change?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" className="kb-chat-send" aria-label="Send" disabled={!text.trim() || busy}>
          <KbIcon name="send" />
        </button>
      </form>
    </aside>
  );
}

function Message({ m, onAct }: { m: ChatMessageView; onAct: (messageId: string, editId: string, kind: "apply" | "discard") => Promise<void> }) {
  if (m.role === "user") return <div className="kb-chat-me">{m.text}</div>;
  return (
    <div className="kb-chat-ai">
      <p>{m.text}</p>
      {m.edits.map((e) => (
        <EditCard key={e.id} e={e} onAct={(kind) => onAct(m.id, e.id, kind)} />
      ))}
      {m.test && (
        <div className="kb-chat-test">
          <span className="kb-chat-label">Sandbox</span>
          {m.test.lead.map((t, i) => (
            <span key={`l${i}`} className="kb-bub in">
              {t}
            </span>
          ))}
          {m.test.error ? (
            <span className="kb-err">{m.test.error}</span>
          ) : m.test.hold ? (
            <span className="kb-quiet">J holds</span>
          ) : (
            m.test.bubbles.map((t, i) => (
              <span key={`b${i}`} className="kb-bub out">
                {t}
              </span>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function EditCard({ e, onAct }: { e: ChatEdit; onAct: (kind: "apply" | "discard") => Promise<void> }) {
  const [pending, setPending] = useState<"apply" | "discard" | null>(null);
  // An append is trimmed when applied, so show it trimmed.
  const rows = e.before.trim() ? lineDiff(e.before, e.after) : lineDiff("", e.after.trim());
  const run = async (kind: "apply" | "discard") => {
    setPending(kind);
    await onAct(kind);
    setPending(null);
  };
  return (
    <div className="kb-chat-edit" data-status={e.status}>
      <div className="kb-chat-edit-head">
        <KbIcon name="file" size={12} />
        <span className="kb-chat-file">{DOC_FILES[e.doc].file}</span>
        {e.status !== "proposed" && <span className="kb-chat-status">{e.status === "applied" ? "Applied" : e.status === "stale" ? "Out of date" : "Discarded"}</span>}
      </div>
      {e.why && <span className="kb-quiet">{e.why}</span>}
      <pre className="kb-chat-diff" aria-label="Change">
        {!e.before.trim() && <span className="kb-chat-at">at the end</span>}
        {rows.map((r, i) => (
          <span key={i} data-op={r.op}>
            {r.op === "add" ? "+ " : r.op === "del" ? "− " : "  "}
            {r.text || " "}
          </span>
        ))}
      </pre>
      {e.status === "proposed" && (
        <div className="kb-chat-actions">
          <button type="button" className="kb-btn kb-btn-p" disabled={pending !== null} onClick={() => run("apply")}>
            {pending === "apply" ? "Applying…" : "Apply"}
          </button>
          <button type="button" className="kb-btn" disabled={pending !== null} onClick={() => run("discard")}>
            Discard
          </button>
        </div>
      )}
    </div>
  );
}
