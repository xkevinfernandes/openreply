"use client";

// Follow-ups (board FollowupsA): Yours to do · Scheduled · Sent · Paused, a
// source filter, Scheduled grouped by day. Explanations live behind (i).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { completeTask, markCall, sendFollowupNow, setFollowupsOn, skipFollowup } from "@/app/(os)/os/follow-ups/actions";
import { sendBroadcastNowAction, skipBroadcastAction, unscheduleBroadcastAction } from "@/app/(os)/os/automations/broadcasts/actions";
import { EmptyState, InfoTip, Tabs } from "@/components/os/ui";
import type { FollowupsHeader } from "@/lib/os/followups-header";
import { chatHref, TIMELINE_TABS, type DayGroup, type Timeline, type TimelineRow, type TimelineTab, type TodoItem } from "@/lib/os/followups-timeline";

const ICON = {
  send: "M13.5 2.5 7 9M13.5 2.5 9.5 13.5 7 9 2.5 6.5l11-4Z",
  skip: "M3.5 3.5 9 8l-5.5 4.5v-9ZM12 3.5v9",
  edit: "M10.5 2.5l3 3-8 8h-3v-3l8-8Z",
  pause: "M5.5 3.5v9M10.5 3.5v9",
  play: "M5 3.5v9l7-4.5-7-4.5Z",
  megaphone: "M2.5 6.5v3h2l5 3v-9l-5 3h-2ZM12 5.5a3.5 3.5 0 0 1 0 5",
};

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

type Act = () => Promise<{ error?: string; notice?: string }>;

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const act = (fn: Act) =>
    start(async () => {
      const r = await fn();
      setMsg(r.error ? { text: r.error, bad: true } : r.notice ? { text: r.notice, bad: false } : null);
      router.refresh();
    });
  return { pending, msg, act };
}

function Ib({ label, d, onClick, href, disabled }: { label: string; d: string; onClick?: () => void; href?: string; disabled?: boolean }) {
  if (href)
    return (
      <Link className="os-icon-btn" href={href} aria-label={label} title={label}>
        <Icon d={d} />
      </Link>
    );
  return (
    <button type="button" className="os-icon-btn" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      <Icon d={d} />
    </button>
  );
}

function Row({ r, act, pending }: { r: TimelineRow; act: (fn: Act) => void; pending: boolean }) {
  const isStep = r.kind === "step";
  return (
    <li className="os-tl-row" data-ready={r.ready || undefined}>
      <span className="os-tl-av" aria-hidden="true">
        {r.initial}
      </span>
      <Link className="os-tl-handle" href={chatHref(r.conversationId)}>
        {r.handle}
      </Link>
      <Link className="os-tl-src" href={r.sourceHref} title={r.source}>
        {r.source}
      </Link>
      <span className="os-tl-preview" title={r.preview ?? r.goal ?? undefined}>
        {r.ready ? <span className="os-tl-dot" aria-label="Draft ready" /> : null}
        {r.preview ?? (
          <>
            <em>J writes this at send time</em> · {r.goal}
          </>
        )}
      </span>
      <span className="os-tl-time">{r.time}</span>
      <span className="os-tl-acts">
        {isStep ? (
          <>
            <Ib label={r.ready ? "Approve and send now" : "Send now"} d={ICON.send} disabled={pending} onClick={() => act(() => sendFollowupNow(r.stepId!))} />
            <Ib label="Skip this step" d={ICON.skip} disabled={pending} onClick={() => act(() => skipFollowup(r.stepId!))} />
            <Ib label="Edit" d={ICON.edit} href={r.ready ? chatHref(r.conversationId) : r.sourceHref} />
            <Ib label="Pause sequence for this contact" d={ICON.pause} disabled={pending} onClick={() => act(() => setFollowupsOn(r.contactId, false))} />
          </>
        ) : (
          <>
            <Ib label="Send now" d={ICON.send} disabled={pending} onClick={() => act(() => sendBroadcastNowAction(r.messageId!))} />
            <Ib label="Leave out" d={ICON.skip} disabled={pending} onClick={() => act(() => skipBroadcastAction(r.messageId!))} />
            <Ib label="Edit" d={ICON.edit} href={r.sourceHref} />
            <Ib label="Unschedule" d={ICON.pause} disabled={pending} onClick={() => act(() => unscheduleBroadcastAction(r.messageId!))} />
          </>
        )}
      </span>
    </li>
  );
}

function Banner({ b }: { b: DayGroup["banners"][number] }) {
  return (
    <div className="os-tl-banner">
      <span className="os-tl-banner-ic">
        <Icon d={ICON.megaphone} />
      </span>
      <span className="os-tl-banner-text">
        <strong>{b.name}</strong> → {b.count} {b.count === 1 ? "contact" : "contacts"} ·{" "}
        <span className="os-tl-warn">{b.kind === "link" ? "link: not pasted yet" : `${b.count === 1 ? "draft" : "drafts"} to review`}</span>
      </span>
      <Link className="os-tl-src" href={b.href}>
        Broadcast · {b.name}
      </Link>
      <span className="os-tl-time">{b.time}</span>
      <Link className="os-button primary os-tl-banner-btn" href={b.href}>
        {b.kind === "link" ? "Add link" : "Review"}
      </Link>
    </div>
  );
}

function Todo({ items, act, pending }: { items: TodoItem[]; act: (fn: Act) => void; pending: boolean }) {
  if (!items.length) return null;
  return (
    <section className="os-tl-todo" aria-labelledby="tl-todo-h">
      <div className="os-tl-todo-head">
        <h2 id="tl-todo-h">Yours to do</h2>
        <span>Only you can send these</span>
      </div>
      <ul>
        {items.map((t) => (
          <li key={t.id}>
            {t.kind === "task" ? (
              <input type="checkbox" id={t.id} aria-label="Done" disabled={pending} onChange={() => act(() => completeTask(t.taskId!))} />
            ) : (
              <input type="checkbox" className="os-tl-todo-mark" disabled aria-hidden="true" tabIndex={-1} />
            )}
            <label htmlFor={t.kind === "task" ? t.id : undefined} className="os-tl-todo-text">
              {t.lead} {t.strong ? <strong>{t.strong}</strong> : null} {t.tail}
            </label>
            <Link className="os-tl-src" href={t.sourceHref}>
              {t.source}
            </Link>
            <span className="os-tl-due" data-warn={t.warn || undefined}>
              {t.due}
            </span>
            {t.kind === "attendance" ? (
              <span className="os-tl-att">
                <button type="button" className="os-link" disabled={pending} onClick={() => act(() => markCall(t.contactId!, "SHOWED"))}>
                  Showed
                </button>
                <button type="button" className="os-link" disabled={pending} onClick={() => act(() => markCall(t.contactId!, "NO_SHOW"))}>
                  No-show
                </button>
              </span>
            ) : (
              <Link className="os-tl-act" href={t.action.href}>
                {t.action.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Nothing anywhere yet: show how follow-ups get made. */
function isEmpty(d: Timeline) {
  return !d.todo.length && !d.scheduled.length && !d.sent.length && !d.paused.length;
}

function Start({ header }: { header: FollowupsHeader }) {
  return (
    <EmptyState
      title="No follow-ups yet"
      action={
        <span className="os-tl-start">
          <Link className="os-button primary" href={header.setupHref}>
            Set up sequences
          </Link>
          <Link className="os-button" href="/os/automations/broadcasts">
            New broadcast
          </Link>
        </span>
      }
    >
      Sequences follow up for a setter. Broadcasts go to a tagged list.
    </EmptyState>
  );
}

export default function FollowupsTimeline({ data, tab, source, header }: { data: Timeline; tab: TimelineTab; source: string; header: FollowupsHeader }) {
  const router = useRouter();
  const { pending, msg, act } = useAct();
  const href = (t: string, s = source) => {
    const q = new URLSearchParams();
    if (t !== "scheduled") q.set("tab", t);
    if (s && s !== "all") q.set("src", s);
    const qs = q.toString();
    return `/os/follow-ups${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="os-tl">
      <header className="os-tl-head">
        <div className="os-tl-title">
          <h1 className="os-title">Follow-ups</h1>
          <InfoTip label="What shows here">Everything scheduled to go out: setter sequences (defined in Knowledge bases) and broadcasts (defined in Automations). Nothing sends without your approve.</InfoTip>
        </div>
        <div className="os-tl-actions">
          <label className="os-tl-filter">
            <span>Source</span>
            <span className="os-select">
              <select value={source} onChange={(e) => router.push(href(tab, e.target.value))} aria-label="Source">
                {data.sources.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <Link className="os-button" href={header.setupHref}>
            Set up sequences
          </Link>
          <Link className="os-button" href="/os/automations/broadcasts">
            New broadcast
          </Link>
        </div>
      </header>

      {header.friday ? (
        <Link className="os-tl-fri" href={header.friday.href} data-on={header.friday.on || undefined}>
          <Icon d={ICON.megaphone} />
          <strong>{header.friday.name}</strong>
          <span>{`Next run ${header.friday.when}${header.friday.on ? "" : " · off"}`}</span>
        </Link>
      ) : null}

      <Tabs
        tabs={TIMELINE_TABS.map((t) => ({ key: t.key, label: t.label, count: t.key === "sent" || t.key === "paused" ? null : data.counts[t.key] }))}
        value={tab}
        ariaLabel="Follow-up views"
        hrefFor={(k) => href(k)}
      />

      {msg ? (
        <div className="os-tl-msg" data-bad={msg.bad || undefined} role="status">
          {msg.text}
        </div>
      ) : null}

      {tab === "todo" || tab === "scheduled" ? <Todo items={data.todo} act={act} pending={pending} /> : null}
      {isEmpty(data) && source === "all" ? <Start header={header} /> : null}
      {tab === "todo" && !data.todo.length && !(isEmpty(data) && source === "all") ? <EmptyState title="Nothing for you right now" /> : null}

      {tab === "scheduled" ? (
        data.scheduled.length ? (
          <section aria-label="Scheduled" className="os-tl-days">
            {data.scheduled.map((g) => (
              <div key={g.date} className="os-tl-day">
                <h3>
                  <span>{g.day}</span>
                  <span className="os-tl-n">{g.rows.length + g.banners.length}</span>
                </h3>
                {g.rows.length ? (
                  <ul className="os-tl-list">
                    {g.rows.map((r) => (
                      <Row key={r.id} r={r} act={act} pending={pending} />
                    ))}
                  </ul>
                ) : null}
                {g.banners.map((b) => (
                  <Banner key={`${b.key}:${b.kind}`} b={b} />
                ))}
              </div>
            ))}
          </section>
        ) : isEmpty(data) && source === "all" ? null : (
          <EmptyState title="Nothing scheduled" />
        )
      ) : null}

      {tab === "sent" ? (
        data.sent.length ? (
          <ul className="os-tl-list">
            {data.sent.map((s) => (
              <li key={s.id} className="os-tl-row" data-variant="sent">
                <span className="os-tl-av" aria-hidden="true">
                  {s.initial}
                </span>
                <Link className="os-tl-handle" href={chatHref(s.conversationId)}>
                  {s.handle}
                </Link>
                <Link className="os-tl-src" href={s.sourceHref}>
                  {s.source}
                </Link>
                <span className="os-tl-preview">{s.preview}</span>
                <span className="os-tl-time os-tl-when">{s.when}</span>
              </li>
            ))}
          </ul>
        ) : isEmpty(data) && source === "all" ? null : (
          <EmptyState title="Nothing sent yet" />
        )
      ) : null}

      {tab === "paused" ? (
        data.paused.length ? (
          <ul className="os-tl-list">
            {data.paused.map((p) => (
              <li key={p.id} className="os-tl-row" data-variant="paused">
                <span className="os-tl-av" aria-hidden="true">
                  {p.initial}
                </span>
                <Link className="os-tl-handle" href={chatHref(p.conversationId)}>
                  {p.handle}
                </Link>
                <Link className="os-tl-src" href={p.sourceHref}>
                  {p.source}
                </Link>
                <span className="os-tl-preview">{p.reason}</span>
                <span className="os-tl-acts">
                  {p.reason === "Follow-ups off" ? <Ib label="Resume follow-ups" d={ICON.play} disabled={pending} onClick={() => act(() => setFollowupsOn(p.contactId, true))} /> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : isEmpty(data) && source === "all" ? null : (
          <EmptyState title="Nothing paused" />
        )
      ) : null}
    </div>
  );
}
