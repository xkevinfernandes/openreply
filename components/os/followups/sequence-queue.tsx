"use client";

// Follow-up sequences on screen: one queued step (Send now / Skip / Cancel
// sequence), a call waiting for Showed / No-show, and Kevin's voice-note
// task. Used by the Follow-ups screen, Home and the thread strip.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelFollowups, completeTask, markCall, sendFollowupNow, skipFollowup } from "@/app/(os)/os/follow-ups/actions";
import Avatar from "@/components/os/inbox/avatar";
import { initialSource, threadName } from "@/components/os/inbox/names";
import { formatSlotShort, tzCity } from "@/lib/os/integrations/calendar/slots";
import type { AttendanceItem, Person, QueuedFollowup, TaskItem } from "@/lib/os/sequences/view";

type Result = { error?: string; notice?: string };

/** "in 5h", "2h ago", "now". */
export function rel(iso: string | null, now: number): string {
  if (!iso) return "";
  const mins = Math.round((new Date(iso).getTime() - now) / 60000);
  const abs = Math.abs(mins);
  if (abs < 2) return "now";
  const s = abs < 60 ? `${abs}m` : abs < 60 * 24 ? `${Math.round(abs / 60)}h` : `${Math.round(abs / 1440)}d`;
  return mins > 0 ? `in ${s}` : `${s} ago`;
}

export function threadHref(conversationId: string | null, extra = ""): string | null {
  return conversationId ? `/os/inbox?tab=sales&c=${encodeURIComponent(conversationId)}${extra}` : null;
}

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Result | null>(null);
  function run(what: string, fn: () => Promise<Result>) {
    setMsg(null);
    setBusy(what);
    start(async () => {
      const r = await fn();
      if (r.error || r.notice) setMsg(r);
      setBusy(null);
      router.refresh();
    });
  }
  return { pending, busy, msg, run };
}

function Msg({ msg }: { msg: Result | null }) {
  if (!msg) return null;
  return (
    <p className={msg.error ? "os-fu-error" : "os-fu-notice"} role={msg.error ? "alert" : "status"}>
      {msg.error ?? msg.notice}
    </p>
  );
}

export function Who({ item }: { item: Person }) {
  const href = threadHref(item.conversationId);
  const name = threadName(item.username, item.fullName);
  return (
    <span className="os-fu-who">
      <Avatar src={item.avatarUrl} username={initialSource(item.username, item.fullName)} size={32} />
      <span className="os-fu-who-text">
        {href ? (
          <Link href={href} className="name">
            {name}
          </Link>
        ) : (
          <span className="name">{name}</span>
        )}
        {item.username && item.fullName && <span className="sub">{item.fullName}</span>}
      </span>
    </span>
  );
}

function whenLine(q: QueuedFollowup, now: number): string {
  const theirs = q.callTz ? ` · ${formatSlotShort(q.dueAt, q.callTz)} ${tzCity(q.callTz)} time` : "";
  return q.status === "DRAFTED" ? "Draft ready" : `${new Date(q.dueAt).getTime() <= now ? "Due now" : `Goes ${rel(q.dueAt, now)}`}${theirs}`;
}

/** One queued step. `compact` = the thread strip (no avatar). */
export function QueueRow({ q, now, compact = false }: { q: QueuedFollowup; now: number; compact?: boolean }) {
  const { pending, busy, msg, run } = useRun();
  const d = q.draft;
  const sendLabel = d ? (d.bubbles.length > 1 ? `Approve & send ${d.bubbles.length}` : "Approve & send") : q.fixedLine ? "Send now" : "Write it now";
  return (
    <div className="os-seq-row" data-status={q.status} data-compact={compact || undefined} aria-busy={pending}>
      <div className="os-fu-row-head">
        {compact ? (
          <span className="os-seq-title">
            <strong>{q.label}</strong>
            <span className="muted">
              {q.sequenceTitle} · {q.position}
            </span>
          </span>
        ) : (
          <Who item={q} />
        )}
        <span className="os-fu-chips">
          {!compact && (
            <span className="chip quiet">
              {q.sequenceTitle} · {q.label}
            </span>
          )}
          <span className={q.status === "DRAFTED" || new Date(q.dueAt).getTime() <= now ? "chip ready" : "chip quiet"}>{whenLine(q, now)}</span>
          {q.window === "human_agent" && (
            <span className="chip flag" title="They last wrote over 24h ago: this goes out under Meta's HUMAN_AGENT tag, approve-only.">
              Outside 24h
            </span>
          )}
          {q.window === "closed" && <span className="chip flag">Window closes first</span>}
          {q.voicePhrase && <span className="chip quiet">Voice clip</span>}
          {q.resource && <span className="chip quiet">+ resource</span>}
        </span>
      </div>

      {d ? (
        <ol className="os-draft-bubbles os-fu-bubbles" aria-label="J's draft">
          {d.bubbles.map((b, i) => (
            <li key={i}>
              <span className="bubble">{b}</span>
            </li>
          ))}
        </ol>
      ) : q.fixedLine ? (
        <p className="os-seq-preview">
          <span className="bubble">{q.fixedLine}</span>
        </p>
      ) : (
        <p className="os-fu-meta">J writes it at the time: {q.intent || "a light follow-up"}</p>
      )}

      <Msg msg={msg} />

      <div className="os-fu-actions">
        <button type="button" className="os-button ghost" disabled={pending} onClick={() => run("cancel", () => cancelFollowups(q.contactId))} title="Stop the rest of this sequence for them">
          {busy === "cancel" ? "Cancelling…" : "Cancel sequence"}
        </button>
        <button type="button" className="os-button ghost" disabled={pending} onClick={() => run("skip", () => skipFollowup(q.stepId))} title="Skip this step; the next one is queued">
          {busy === "skip" ? "Skipping…" : "Skip"}
        </button>
        <button type="button" className="os-button primary" disabled={pending} onClick={() => run("send", () => sendFollowupNow(q.stepId))}>
          {busy === "send" ? (d || q.fixedLine ? "Sending…" : "J is writing…") : sendLabel}
        </button>
      </div>
    </div>
  );
}

export function AttendanceRow({ a, now, compact = false }: { a: AttendanceItem; now: number; compact?: boolean }) {
  const { pending, busy, msg, run } = useRun();
  return (
    <div className="os-seq-row" data-status="attendance" data-compact={compact || undefined} aria-busy={pending}>
      <div className="os-fu-row-head">
        {compact ? (
          <span className="os-seq-title">
            <strong>Did they show?</strong>
            <span className="muted">Call {rel(a.start, now)}</span>
          </span>
        ) : (
          <Who item={a} />
        )}
        {!compact && <span className="chip quiet">Call {rel(a.start, now)} · did they show?</span>}
      </div>
      <Msg msg={msg} />
      <div className="os-fu-actions">
        <button type="button" className="os-button" disabled={pending} onClick={() => run("no", () => markCall(a.contactId, "NO_SHOW"))}>
          {busy === "no" ? "Saving…" : "No-show"}
        </button>
        <button type="button" className="os-button primary" disabled={pending} onClick={() => run("yes", () => markCall(a.contactId, "SHOWED"))}>
          {busy === "yes" ? "Saving…" : "Showed"}
        </button>
      </div>
    </div>
  );
}

export function TaskCard({ t, compact = false }: { t: TaskItem; compact?: boolean }) {
  const { pending, busy, msg, run } = useRun();
  const c = t.context;
  const record = threadHref(t.conversationId, "&voice=1");
  return (
    <div className="os-seq-row os-task" data-status="task" data-compact={compact || undefined} aria-busy={pending}>
      <div className="os-fu-row-head">
        {compact ? (
          <span className="os-seq-title">
            <strong>{t.title}</strong>
            <span className="muted">They showed. This one is yours, not J&apos;s.</span>
          </span>
        ) : (
          <Who item={t} />
        )}
        {!compact && <span className="chip ready">Voice note to send</span>}
      </div>
      <dl className="os-task-context">
        {c.goal && (
          <div>
            <dt>Their goal</dt>
            <dd>{c.goal}</dd>
          </div>
        )}
        {c.pain && (
          <div>
            <dt>What&apos;s in the way</dt>
            <dd>{c.pain}</dd>
          </div>
        )}
        {c.notes && (
          <div>
            <dt>Your notes</dt>
            <dd>{c.notes}</dd>
          </div>
        )}
        {!c.goal && !c.pain && c.lastWords.length > 0 && (
          <div>
            <dt>Their last words</dt>
            <dd>{c.lastWords.map((w) => `“${w}”`).join(" · ")}</dd>
          </div>
        )}
      </dl>
      <Msg msg={msg} />
      <div className="os-fu-actions">
        <button type="button" className="os-button ghost" disabled={pending} onClick={() => run("done", () => completeTask(t.id, true))}>
          {busy === "done" ? "Saving…" : "Mark done"}
        </button>
        {record && (
          <Link className="os-button primary" href={record}>
            Record voice note
          </Link>
        )}
      </div>
    </div>
  );
}
