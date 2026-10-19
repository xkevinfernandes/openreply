"use client";

// Follow-up Friday builder (board AutomationsB): Audience · Link · Message ·
// Pacing on the left, J's personalised drafts on the right. Kevin approves,
// edits or leaves out each draft; only approved ones get scheduled.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  approveMessageAction,
  audienceAction,
  editMessageAction,
  regenerateAction,
  saveBroadcastAction,
  scheduleAction,
  setTimeAction,
  skipMessageAction,
  type ActionResult,
} from "@/app/(os)/os/automations/broadcasts/actions";
import { InfoTip, SetterMark } from "@/components/os/ui";
import type { BuilderData, BuilderMessage } from "@/lib/os/broadcasts/engine";
import { shortLink } from "@/lib/os/broadcasts/template";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHOW_FIRST = 4;

const I = {
  tag: "M2.5 2.5h5.2l5.8 5.8-5.2 5.2-5.8-5.8V2.5ZM5.5 5.5h.01",
  x: "M4.5 4.5l7 7M11.5 4.5l-7 7",
  link: "M6.5 9.5 9.5 6.5M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1",
  play: "M1.8 5c0-1 .8-1.8 1.8-1.8h8.8c1 0 1.8.8 1.8 1.8v6c0 1-.8 1.8-1.8 1.8H3.6c-1 0-1.8-.8-1.8-1.8V5ZM6.8 6v4L10 8 6.8 6Z",
  clock: "M8 13.8A5.8 5.8 0 1 0 8 2.2a5.8 5.8 0 0 0 0 11.6ZM8 4.8V8l2.2 1.4",
  regen: "M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.5h-2.5",
};

function Svg({ d, size = 12 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const act = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg(r.error ? { text: r.error, bad: true } : r.notice ? { text: r.notice, bad: false } : null);
      if (!r.error) after?.();
      router.refresh();
    });
  return { pending, msg, act, setMsg };
}

function localTime(iso: string | null, tz: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

const STATUS_LABEL: Partial<Record<BuilderMessage["status"], string>> = {
  approved: "Approved",
  scheduled: "Scheduled",
  sent: "Sent",
  failed: "Failed",
};

function DraftCard({ m, data, act, pending }: { m: BuilderMessage; data: BuilderData; act: ReturnType<typeof useAct>["act"]; pending: boolean }) {
  const key = data.broadcast.key;
  const tz = data.broadcast.timezone;
  const [text, setText] = useState(m.text.join("\n"));
  const [fu, setFu] = useState(m.followupBubbles.join("\n"));
  const locked = m.status === "sent" || m.status === "scheduled";
  const save = () => {
    if (text === m.text.join("\n") && fu === m.followupBubbles.join("\n")) return;
    act(() => editMessageAction(key, m.id, { text, followup: fu }));
  };
  const time = localTime(m.scheduledAt, tz);
  const fuWhen = data.broadcast.followupDelayMin >= 30 ? "+1 h" : "+3–8 min";
  return (
    <article className="os-bc-card" data-status={m.status}>
      <header>
        <span className="os-bc-av" aria-hidden="true">
          {m.initial}
        </span>
        <span className="os-bc-who">
          <span className="os-bc-handle">{m.handle}</span>
          <span className="os-bc-ctx">{m.context}</span>
        </span>
        <label className="os-bc-time" title={`Planned send, change time for ${m.handle}`}>
          <Svg d={I.clock} />
          <span className="sr-only">Planned send time for {m.handle}</span>
          <input
            type="time"
            defaultValue={time}
            key={time}
            disabled={locked || pending}
            onBlur={(e) => {
              if (e.target.value && e.target.value !== time) act(() => setTimeAction(key, m.id, e.target.value));
            }}
          />
        </label>
      </header>
      <div className="os-bc-body">
        <textarea
          className="os-bc-ed"
          aria-label={`Message to ${m.handle}`}
          rows={Math.max(1, text.split("\n").length)}
          value={text}
          disabled={locked}
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
        />
        {data.run ? (
          <span className="os-bc-link" title="Sent as its own message">
            <Svg d={I.link} />
            {shortLink(data.run.link)}
          </span>
        ) : null}
        {m.followupBubbles.length || fu ? (
          <>
            <span className="os-bc-when">{fuWhen}</span>
            <textarea
              className="os-bc-ed"
              aria-label={`Follow-up to ${m.handle}`}
              rows={Math.max(1, fu.split("\n").length)}
              value={fu}
              disabled={locked}
              onChange={(e) => setFu(e.target.value)}
              onBlur={save}
            />
          </>
        ) : null}
      </div>
      <footer>
        {STATUS_LABEL[m.status] ? (
          <span className="os-bc-state" data-status={m.status}>
            {STATUS_LABEL[m.status]}
            {m.status === "scheduled" ? ` ${time}` : ""}
          </span>
        ) : null}
        {m.error ? (
          <span className="os-bc-err" title={m.error}>
            {m.error}
          </span>
        ) : null}
        {m.edited ? <span className="os-bc-ctx">Edited</span> : null}
        <span className="os-bc-grow" />
        {m.status === "drafted" ? (
          <>
            <button type="button" className="os-bc-quiet" disabled={pending} onClick={() => act(() => regenerateAction(key, m.id))}>
              Regenerate
            </button>
            <button type="button" className="os-bc-quiet" disabled={pending} onClick={() => act(() => skipMessageAction(key, m.id, true))}>
              Leave out
            </button>
            <button type="button" className="os-button primary os-bc-approve" disabled={pending} onClick={() => act(() => approveMessageAction(key, m.id, true))}>
              Approve
            </button>
          </>
        ) : m.status === "approved" || m.status === "scheduled" ? (
          <button type="button" className="os-bc-quiet" disabled={pending} onClick={() => act(() => approveMessageAction(key, m.id, false))}>
            {m.status === "scheduled" ? "Unschedule" : "Undo"}
          </button>
        ) : null}
      </footer>
    </article>
  );
}

export default function BroadcastBuilder({ data }: { data: BuilderData }) {
  const b = data.broadcast;
  const { pending, msg, act } = useAct();
  const [link, setLink] = useState(data.run?.link ?? b.link ?? "");
  const [template, setTemplate] = useState(b.template.replace(/\n?\{link\}\n?/g, "\n").trim());
  const [followupOn, setFollowupOn] = useState(Boolean(b.followupTemplate));
  const [followup, setFollowup] = useState(b.followupTemplate ?? "");
  const [delay, setDelay] = useState(b.followupDelayMin >= 30 ? 60 : 5);
  const [day, setDay] = useState(b.windowDay);
  const [from, setFrom] = useState(b.windowStart);
  const [to, setTo] = useState(b.windowEnd);
  const [allChips, setAllChips] = useState(false);
  const [allDrafts, setAllDrafts] = useState(false);
  const tpl = useRef<HTMLTextAreaElement>(null);
  const draftsRef = useRef<HTMLElement>(null);

  const input = (extra: { enabled?: boolean } = {}) => ({
    link: link.trim() ? link.trim() : null,
    template: `${template.trim()}\n{link}`,
    followupOn,
    followupTemplate: followupOn ? followup : null,
    followupDelayMin: delay,
    windowDay: day,
    windowStart: from,
    windowEnd: to,
    ...extra,
  });

  const open = data.messages.filter((m) => m.status === "drafted" || m.status === "approved" || m.status === "scheduled" || m.status === "sent" || m.status === "failed");
  const outside = data.messages.filter((m) => m.status === "outside_window");
  const left = data.messages.filter((m) => m.status === "skipped");
  const approved = data.messages.filter((m) => m.status === "approved").length;
  const drafted = data.messages.filter((m) => m.status === "drafted").length;
  const shown = allDrafts ? open : open.slice(0, SHOW_FIRST);
  const chips = allChips ? data.audience.handles : data.audience.handles.slice(0, SHOW_FIRST);
  const ticks = data.ticks;
  const labels = data.hours;
  const insertVar = (v: string) => {
    const el = tpl.current;
    if (!el) return setTemplate((t) => `${t}${v}`);
    const s = el.selectionStart ?? template.length;
    const e = el.selectionEnd ?? template.length;
    setTemplate(template.slice(0, s) + v + template.slice(e));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + v.length, s + v.length);
    });
  };
  const primary = () => {
    if (approved) return act(() => scheduleAction(b.key));
    if (drafted) {
      draftsRef.current?.querySelector<HTMLTextAreaElement>("article[data-status='drafted'] textarea")?.focus();
      return;
    }
    act(() => saveBroadcastAction(b.key, input()));
  };

  return (
    <div className="os-bc">
      <div className="os-bc-page">
        <header className="os-bc-head">
          <nav aria-label="Breadcrumb" className="os-bc-crumbs">
            <Link href="/os/automations">Automations</Link> / <Link href="/os/automations/broadcasts">Broadcasts</Link>
          </nav>
          <div className="os-bc-titlerow">
            <h1>{b.name}</h1>
            <button
              type="button"
              className="os-bc-onoff"
              aria-pressed={b.enabled}
              title={b.enabled ? "On: click to turn off" : "Off: click to turn on"}
              disabled={pending}
              onClick={() => act(() => saveBroadcastAction(b.key, { enabled: !b.enabled }))}
            >
              <span className="os-bc-dot" data-on={b.enabled || undefined} />
              {b.enabled ? "On" : "Off"} · {data.windowLabel}
            </button>
          </div>
        </header>

        {msg ? (
          <div className="os-tl-msg" data-bad={msg.bad || undefined} role="status">
            {msg.text}
          </div>
        ) : null}
        {data.cap.pausedAll ? <div className="os-tl-msg" data-bad>Pause all is on. Nothing sends.</div> : null}

        <div className="os-bc-cols">
          <form
            className="os-bc-form"
            onSubmit={(e) => {
              e.preventDefault();
              act(() => saveBroadcastAction(b.key, input()));
            }}
          >
            <fieldset className="os-bc-sec">
              <legend>Audience</legend>
              <div className="os-bc-stack">
                <div className="os-bc-row">
                  <span className="os-bc-tag">
                    <Svg d={I.tag} />
                    {b.audienceTag}
                  </span>
                  <span className="os-bc-num">{data.audience.count}</span>
                  {data.audience.outside.length ? (
                    <span className="os-bc-sub">
                      {data.audience.eligible} in window
                      <InfoTip label="Who is outside the window">
                        Only people inside Instagram&apos;s 24h window get it. Outside: {data.audience.outside.map((o) => o.handle).join(", ")}. They&apos;re back in if they write before the send; Regenerate all re-checks.
                      </InfoTip>
                    </span>
                  ) : null}
                </div>
                <ul aria-label="Contacts in this send" className="os-bc-chips">
                  {chips.map((c) => (
                    <li key={c.contactId} className="os-bc-chip">
                      {c.handle}
                      <button type="button" className="os-bc-x" aria-label={`Remove ${c.handle}`} disabled={pending} onClick={() => act(() => audienceAction(b.key, c.contactId, false))}>
                        <Svg d={I.x} />
                      </button>
                    </li>
                  ))}
                  {data.audience.handles.length > SHOW_FIRST ? (
                    <li>
                      <button type="button" className="os-bc-more" onClick={() => setAllChips((v) => !v)}>
                        {allChips ? "Less" : `+${data.audience.handles.length - SHOW_FIRST} more`}
                      </button>
                    </li>
                  ) : null}
                </ul>
              </div>
            </fieldset>

            <fieldset className="os-bc-sec">
              <legend>Link</legend>
              <div className="os-bc-stack os-bc-stack-tight">
                <label htmlFor="bc-link" className="sr-only">
                  Link to send
                </label>
                <input id="bc-link" className="os-input" type="url" inputMode="url" value={link} placeholder="Paste any link" onChange={(e) => setLink(e.target.value)} />
                {data.run ? (
                  <span className="os-bc-sub os-bc-inline">
                    <Svg d={I.play} />
                    {shortLink(data.run.link)}
                  </span>
                ) : null}
              </div>
            </fieldset>

            <fieldset className="os-bc-sec">
              <legend>Message</legend>
              <div className="os-bc-stack">
                <div className="os-bc-stack os-bc-stack-tight">
                  <label htmlFor="bc-msg" className="sr-only">
                    Message template
                  </label>
                  <textarea id="bc-msg" ref={tpl} className="os-textarea os-bc-ta" rows={Math.max(1, template.split("\n").length)} value={template} onChange={(e) => setTemplate(e.target.value)} />
                  <span className="os-bc-link" aria-label="Link, sent as its own message" title="Sent as its own message">
                    <Svg d={I.link} />
                    {"{link}"}
                  </span>
                  <div className="os-bc-row">
                    <button type="button" className="os-bc-var" onClick={() => insertVar("{first_name}")}>
                      {"{first_name}"}
                    </button>
                  </div>
                </div>
                <div className="os-bc-stack os-bc-stack-tight os-bc-split">
                  <div className="os-bc-row">
                    <label className="os-bc-chk">
                      <input type="checkbox" checked={followupOn} onChange={(e) => setFollowupOn(e.target.checked)} />
                      <span className="os-bc-strong">Follow-up</span>
                    </label>
                    <label htmlFor="bc-delay" className="sr-only">
                      Follow-up delay
                    </label>
                    <span className="os-select os-bc-small">
                      <select id="bc-delay" value={delay} disabled={!followupOn} onChange={(e) => setDelay(Number(e.target.value))}>
                        <option value={5}>3–8 min later</option>
                        <option value={60}>1 h later</option>
                      </select>
                    </span>
                  </div>
                  <label htmlFor="bc-fu" className="sr-only">
                    Follow-up template
                  </label>
                  <textarea id="bc-fu" className="os-textarea os-bc-ta" rows={1} value={followup} disabled={!followupOn} onChange={(e) => setFollowup(e.target.value)} />
                </div>
                <div className="os-bc-j">
                  <div className="os-bc-row">
                    <label className="os-bc-chk" title="Always on">
                      <input type="checkbox" checked readOnly disabled />
                      <span className="os-bc-strong os-bc-inline">
                        <SetterMark name="J" />J personalises each
                      </span>
                    </label>
                    <span className="os-bc-grow" />
                    <InfoTip label="How J personalises">
                      J rewrites your message for each person from what it knows about them and where the chat is: in a live thread it slides in (&quot;by the way, just did this video…&quot;), in a quiet one it opens warm (&quot;thought of you…&quot;). The link always goes on its own.
                    </InfoTip>
                  </div>
                  <div className="os-bc-row os-bc-indent">
                    <label className="os-bc-chk">
                      <input type="checkbox" checked readOnly disabled />
                      <span>Contact context</span>
                    </label>
                    <label className="os-bc-chk">
                      <input type="checkbox" checked readOnly disabled />
                      <span>Conversation state</span>
                    </label>
                  </div>
                </div>
              </div>
            </fieldset>

            <fieldset className="os-bc-sec os-bc-last">
              <legend>Pacing</legend>
              <div className="os-bc-stack">
                <div className="os-bc-row">
                  <span className="os-select os-bc-small">
                    <select aria-label="Day" value={day} onChange={(e) => setDay(Number(e.target.value))}>
                      {DAYS.map((d, i) => (
                        <option key={d} value={i}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </span>
                  <label htmlFor="bc-from" className="sr-only">
                    From
                  </label>
                  <input id="bc-from" className="os-input os-bc-hm" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
                  <span className="os-bc-sub">to</span>
                  <label htmlFor="bc-to" className="sr-only">
                    To
                  </label>
                  <input id="bc-to" className="os-input os-bc-hm" type="time" value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
                <div className="os-bc-stack os-bc-stack-tight">
                  <div className="os-bc-strip" role="img" aria-label={`Planned send times between ${b.windowStart} and ${b.windowEnd}`}>
                    {ticks.map((p, i) => (
                      <span key={i} className="os-bc-tick" style={{ left: `${p}%` }} />
                    ))}
                  </div>
                  <div className="os-bc-hours">
                    {labels.map((l) => (
                      <span key={l}>{l}</span>
                    ))}
                  </div>
                </div>
                <div className="os-bc-stack os-bc-stack-tight">
                  <label className="os-bc-chk" title="Always on: normal jitter, never on the minute">
                    <input type="checkbox" checked readOnly disabled />
                    <span>Random send times</span>
                  </label>
                  <label className="os-bc-chk" title="Always on: near-duplicates are rewritten">
                    <input type="checkbox" checked readOnly disabled />
                    <span>No two identical</span>
                  </label>
                  <label className="os-bc-chk" title="Always on: every bubble counts">
                    <input type="checkbox" checked readOnly disabled />
                    <span>Daily cap</span>
                    <span className="os-bc-sub os-bc-num-sm">
                      {data.cap.sentToday} / {data.cap.cap} today
                    </span>
                  </label>
                </div>
              </div>
            </fieldset>
            <button type="submit" hidden />
          </form>

          <aside className="os-bc-drafts" aria-labelledby="bc-dr" ref={draftsRef}>
            <div className="os-bc-drafts-head">
              <h2 id="bc-dr">
                Drafts{" "}
                <span className="os-bc-sub os-bc-num-sm">
                  {open.length} of {data.audience.count}
                </span>
              </h2>
              {data.run ? (
                <button type="button" className="os-bc-btn-sm" disabled={pending} onClick={() => act(() => regenerateAction(b.key, null))}>
                  <Svg d={I.regen} />
                  Regenerate all
                </button>
              ) : null}
            </div>
            {!data.run ? <p className="os-bc-empty">Paste this week&apos;s link and save. J drafts one message per person.</p> : null}
            {shown.map((m) => (
              <DraftCard key={`${m.id}:${m.bubbles.join("|")}:${m.followupBubbles.join("|")}:${m.status}`} m={m} data={data} act={act} pending={pending} />
            ))}
            {open.length > SHOW_FIRST ? (
              <button type="button" className="os-bc-quiet os-bc-showmore" onClick={() => setAllDrafts((v) => !v)}>
                {allDrafts ? "Show fewer" : `Show ${open.length - SHOW_FIRST} more`}
              </button>
            ) : null}
            {outside.length ? (
              <details className="os-bc-aside-list">
                <summary>
                  Outside window <span className="os-bc-num-sm">{outside.length}</span>
                </summary>
                <ul>
                  {outside.map((m) => (
                    <li key={m.id}>
                      <span>{m.handle}</span>
                      <span className="os-bc-sub">{m.error ?? "Outside the 24h window"}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {left.length ? (
              <details className="os-bc-aside-list">
                <summary>
                  Left out <span className="os-bc-num-sm">{left.length}</span>
                </summary>
                <ul>
                  {left.map((m) => (
                    <li key={m.id}>
                      <span>{m.handle}</span>
                      <button type="button" className="os-bc-quiet" disabled={pending} onClick={() => act(() => skipMessageAction(b.key, m.id, false))}>
                        Put back
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </aside>
        </div>
      </div>

      <footer className="os-bc-foot">
        <span className="os-bc-sub os-bc-num-sm" aria-live="polite">
          {pending ? "Working…" : `${data.audience.count} contacts${approved ? ` · ${approved} approved` : ""}`}
        </span>
        <div className="os-bc-row">
          <button type="button" className="os-button" disabled={pending} onClick={() => act(() => saveBroadcastAction(b.key, input()))}>
            Save
          </button>
          <button type="button" className="os-button primary" disabled={pending || (!approved && !drafted && !link.trim())} onClick={primary}>
            {approved ? `Schedule ${approved} approved` : "Review drafts"}
          </button>
        </div>
      </footer>
    </div>
  );
}
