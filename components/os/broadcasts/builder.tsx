"use client";

// One broadcast (Friday board): a fixed list of five steps on one screen.
// Start, Who, Messages and Personalise (each shows its summary, Edit opens
// it), then Review: Make drafts, approve, edit, skip or Send myself, then
// Send / Schedule. Styled like the workflow builder's cards, not its canvas.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, useTransition } from "react";
import {
  approveAllAction,
  approveMessageAction,
  cancelAction,
  duplicateAction,
  editMessageAction,
  extendEndAction,
  includeAnywayAction,
  makeDraftsAction,
  newResourceAction,
  newToUnsentAction,
  redraftOneAction,
  redraftWroteSinceAction,
  reopenAction,
  saveStepsAction,
  sendAction,
  skipMessageAction,
  type ActionResult,
} from "@/app/(os)/os/automations/broadcasts/actions";
import { Pill } from "@/components/os/ui";
import type { BroadcastPage, ReviewItem, StepsInput } from "@/lib/os/broadcasts/engine";
import type { PickerResource } from "@/lib/os/broadcasts/resources";
import { serialQueue, stepStamps } from "@/lib/os/broadcasts/builder-state";
import { NOT_SENT_REASONS, SKIP_LABEL, type BroadcastBubble, type PersonaliseMode } from "@/lib/os/broadcasts/types";

type Act = (fn: () => Promise<ActionResult>, after?: (r: ActionResult) => void) => void;

/** An in-app "are you sure" (never the browser's confirm()). */
type Question = { text: string; yes: string; no?: string; onYes: () => void };
type Ask = (q: Question) => void;
const AskContext = createContext<Ask>(() => {});

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [, startQuiet] = useTransition();
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  // Every save goes through one queue, in the order it was made.
  const [enqueue] = useState(serialQueue);
  const runWith =
    (begin: typeof start): Act =>
    (fn, after) =>
      void enqueue(
        () =>
          new Promise<void>((done) =>
            begin(async () => {
              try {
                // Duplicate / New broadcast redirect on the server: nothing comes back.
                const r = (await fn()) ?? {};
                setMsg(r.error ? { text: r.error, bad: true } : r.notice ? { text: r.notice, bad: false } : null);
                if (!r.error) after?.(r);
                if (r.href) router.push(r.href);
                else router.refresh();
              } finally {
                done();
              }
            })
          )
      );
  const act = runWith(start);
  // The rename (saved on blur) never disables buttons: a click that blurred the
  // name still lands, and its save runs after the rename.
  const actQuiet = runWith(startQuiet);
  return { pending, msg, setMsg, act, actQuiet };
}

/** Save a step; with drafts made, ask first and save again on yes. */
function saveStep(act: Act, ask: Ask, key: string, input: StepsInput, done: () => void) {
  act(
    () => saveStepsAction(key, input),
    (r) => {
      if (r.confirm) {
        ask({ text: r.confirm, yes: "Remake drafts", no: "Keep editing", onYes: () => act(() => saveStepsAction(key, input, true), done) });
        return;
      }
      done();
    }
  );
}

function ConfirmBar({ q, onClose, pending }: { q: Question; onClose: () => void; pending: boolean }) {
  const no = useRef<HTMLButtonElement>(null);
  useEffect(() => no.current?.focus(), []);
  return (
    <div className="os-bb-confirm os-well" role="alertdialog" aria-label={q.text} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <span>{q.text}</span>
      <span className="os-bb-actions">
        <button ref={no} type="button" className="os-button" onClick={onClose}>
          {q.no ?? "Keep it"}
        </button>
        <button
          type="button"
          className="os-button primary"
          disabled={pending}
          onClick={() => {
            onClose();
            q.onYes();
          }}
        >
          {q.yes}
        </button>
      </span>
    </div>
  );
}

const MODES: { mode: PersonaliseMode; name: string; sub: string }[] = [
  { mode: "per_person", name: "Per person", sub: "J rewrites it for each person from your chat with them. Links stay as you set them." },
  { mode: "variations", name: "5 variations", sub: "J writes 5 versions once; people are spread across them." },
  { mode: "as_written", name: "As written", sub: "No rewriting; {first_name} filled in." },
];

function shortUrl(u: string): string {
  return u.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

function Actions({ onCancel, onSave, pending, disabled }: { onCancel: () => void; onSave: () => void; pending: boolean; disabled?: boolean }) {
  return (
    <div className="os-bb-actions">
      <button type="button" className="os-button" onClick={onCancel}>
        Cancel
      </button>
      <button type="button" className="os-button primary" disabled={pending || disabled} onClick={onSave}>
        Save
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- steps

function Step({ n, label, summary, editing, canEdit, onEdit, children }: { n: number; label: string; summary: React.ReactNode; editing: boolean; canEdit: boolean; onEdit: () => void; children: React.ReactNode }) {
  return (
    <li className="os-bb-step">
      <div className="os-bb-rail" aria-hidden="true">
        <span className="os-bb-n">{n}</span>
        <span className="os-bb-line" />
      </div>
      <div className="os-card os-bb-card">
        <div className="os-bb-card-head">
          <h2 className="os-bb-label">{label}</h2>
          {canEdit && !editing ? (
            <button type="button" className="os-bc-quiet" onClick={onEdit}>
              Edit
            </button>
          ) : null}
        </div>
        {editing ? children : summary}
      </div>
    </li>
  );
}

function StartStep({ data, act, pending, canEdit }: { data: BroadcastPage; act: Act; pending: boolean; canEdit: boolean }) {
  const ask = useContext(AskContext);
  const b = data.broadcast;
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState(b.startMode);
  const [end, setEnd] = useState(b.startMode === "now" ? b.windowEnd : data.start.defaultNowEnd);
  const [date, setDate] = useState(b.sendDate ?? "");
  const [from, setFrom] = useState(b.windowStart);
  const [to, setTo] = useState(b.windowEnd);
  const save = () =>
    saveStep(act, ask, b.key, mode === "now" ? { startMode: "now", windowEnd: end } : { startMode: "window", sendDate: date || null, windowStart: from, windowEnd: to }, () => setEditing(false));
  return (
    <Step
      n={1}
      label="Start"
      editing={editing}
      canEdit={canEdit}
      onEdit={() => setEditing(true)}
      summary={
        <div className="os-bb-sum">
          <span className="os-bb-strong">{b.startMode === "now" && !b.sendDate ? `From when you press Send until ${b.windowEnd} today` : data.start.label}</span>
          <span className="os-bb-sub">{b.timezone} · nothing spills into the next day</span>
        </div>
      }
    >
      <div className="os-bb-form">
        <div className="os-segmented" role="group" aria-label="When">
          <button type="button" aria-pressed={mode === "now"} onClick={() => setMode("now")}>
            Now
          </button>
          <button type="button" aria-pressed={mode === "window"} onClick={() => setMode("window")}>
            Window
          </button>
        </div>
        {mode === "now" ? (
          <label className="os-bb-row">
            <span className="os-bb-sub">From when you press Send until</span>
            <input className="os-input os-bb-time" type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="End time today" />
            <span className="os-bb-sub">today</span>
          </label>
        ) : (
          <div className="os-bb-row">
            <input className="os-input os-bb-date" type="date" value={date} min={data.start.today} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
            <input className="os-input os-bb-time" type="time" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Start" />
            <span className="os-bb-sub">to</span>
            <input className="os-input os-bb-time" type="time" value={to} onChange={(e) => setTo(e.target.value)} aria-label="End" />
          </div>
        )}
        <span className="os-bb-sub">{b.timezone}</span>
        <Actions onCancel={() => setEditing(false)} onSave={save} pending={pending} />
      </div>
    </Step>
  );
}

function WhoStep({ data, tags, act, pending, canEdit }: { data: BroadcastPage; tags: { id: string; name: string }[]; act: Act; pending: boolean; canEdit: boolean }) {
  const ask = useContext(AskContext);
  const b = data.broadcast;
  const [editing, setEditing] = useState(!b.audienceTagId && !b.contactIds.length && canEdit);
  const [tagId, setTagId] = useState(b.audienceTagId ?? "");
  const w = data.who;
  return (
    <Step
      n={2}
      label="Who"
      editing={editing}
      canEdit={canEdit}
      onEdit={() => setEditing(true)}
      summary={
        <div className="os-bb-sum">
          {w ? (
            <>
              <span className="os-bb-strong">
                {w.fixed !== null ? (
                  `${w.fixed} people from an earlier broadcast`
                ) : (
                  <>
                    Tagged <span className="os-bcl-tag">{w.tag}</span> · {w.total} people
                  </>
                )}
              </span>
              {w.total ? (
                <dl className="os-bb-who">
                  {w.rows.map((r) => (
                    <div key={r.label} data-main={r.main || undefined}>
                      <dt>{r.label}</dt>
                      <dd>{r.n}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <span className="os-bb-warn">No one has this tag</span>
              )}
            </>
          ) : b.audienceTag ? (
            <span className="os-bb-strong">
              Tagged <span className="os-bcl-tag">{b.audienceTag}</span>
            </span>
          ) : b.contactIds.length ? (
            <span className="os-bb-strong">{b.contactIds.length} people from an earlier broadcast</span>
          ) : (
            <span className="os-bb-sub">Pick a tag</span>
          )}
        </div>
      }
    >
      <div className="os-bb-form">
        <label className="os-bb-row">
          <span className="os-bb-sub">Tagged</span>
          <span className="os-select">
            <select value={tagId} onChange={(e) => setTagId(e.target.value)} aria-label="Tag">
              <option value="">Pick a tag</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </span>
        </label>
        <Actions onCancel={() => setEditing(false)} onSave={() => saveStep(act, ask, b.key, { audienceTagId: tagId }, () => setEditing(false))} pending={pending} disabled={!tagId} />
      </div>
    </Step>
  );
}

function ResourcePicker({ resources, onPick, onClose }: { resources: PickerResource[]; onPick: (r: { id: string; name: string; link: string }) => void; onClose: () => void }) {
  const [making, setMaking] = useState(false);
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="os-bb-picker os-well">
      <div role="listbox" aria-label="Pick a resource" className="os-bb-picklist">
        {resources.map((r) => (
          <button
            key={r.id}
            type="button"
            role="option"
            aria-selected={false}
            aria-disabled={!r.link}
            className="os-bb-pick"
            disabled={!r.link}
            title={r.link ?? "Add a link first"}
            onClick={() => r.link && onPick({ id: r.id, name: r.name, link: r.link })}
          >
            <span>{r.name}</span>
            <span className="os-bb-sub">{r.link ? shortUrl(r.link) : "add a link first"}</span>
          </button>
        ))}
      </div>
      {making ? (
        <div className="os-bb-newres">
          <input className="os-input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Resource name" />
          <input className="os-input" placeholder="https://" type="url" required value={link} onChange={(e) => setLink(e.target.value)} aria-label="Resource link" />
          {error ? <span className="os-bb-warn">{error}</span> : null}
          <div className="os-bb-actions">
            <button type="button" className="os-button" onClick={() => setMaking(false)}>
              Back
            </button>
            <button
              type="button"
              className="os-button primary"
              disabled={pending || !name.trim() || !link.trim()}
              onClick={() =>
                start(async () => {
                  const r = await newResourceAction({ name, link });
                  if (r.error || !r.resource) {
                    setError(r.error ?? "Didn't save.");
                    return;
                  }
                  onPick(r.resource);
                  router.refresh();
                })
              }
            >
              Save and pick
            </button>
          </div>
        </div>
      ) : (
        <div className="os-bb-actions">
          <button type="button" className="os-bc-quiet" onClick={() => setMaking(true)}>
            + New resource
          </button>
          <button type="button" className="os-bc-quiet" onClick={onClose}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}

function MessagesStep({ data, resources, act, pending, canEdit }: { data: BroadcastPage; resources: PickerResource[]; act: Act; pending: boolean; canEdit: boolean }) {
  const ask = useContext(AskContext);
  const b = data.broadcast;
  const blank = !b.bubbles.some((x) => x.type === "link" || x.text.trim());
  const [editing, setEditing] = useState((blank || data.emptyLink) && canEdit);
  const [bubbles, setBubbles] = useState<BroadcastBubble[]>(b.bubbles.length ? b.bubbles : [{ type: "text", text: "" }]);
  const [fuOn, setFuOn] = useState(Boolean(b.followupTemplate));
  const [fu, setFu] = useState(b.followupTemplate ?? "");
  const [delay, setDelay] = useState(b.followupDelayMin);
  const [picking, setPicking] = useState<number | null>(null);
  const set = (i: number, x: BroadcastBubble) => setBubbles((all) => all.map((y, j) => (j === i ? x : y)));
  const move = (i: number, d: -1 | 1) =>
    setBubbles((all) => {
      const j = i + d;
      if (j < 0 || j >= all.length) return all;
      const out = [...all];
      [out[i], out[j]] = [out[j], out[i]];
      return out;
    });
  const remove = (i: number) => setBubbles((all) => all.filter((_, j) => j !== i));
  const addLink = (open: boolean) => {
    const at = bubbles.length;
    setBubbles((all) => [...all, { type: "link", url: null, resourceId: null, label: null }]);
    if (open) setPicking(at);
  };
  const save = () =>
    saveStep(act, ask, b.key, { bubbles: bubbles.filter((x) => x.type === "link" || x.text.trim()), followupTemplate: fuOn ? fu : null, followupDelayMin: delay }, () => setEditing(false));

  return (
    <Step
      n={3}
      label="Messages"
      editing={editing}
      canEdit={canEdit}
      onEdit={() => setEditing(true)}
      summary={
        <div className="os-bb-sum">
          <div className="os-bb-bubbles">
            {b.bubbles.map((x, i) =>
              x.type === "text" ? (
                <div key={i} className="os-bb-bubble">
                  {x.text}
                </div>
              ) : (
                <div key={i} className="os-bb-bubble" data-link data-empty={!x.url || undefined}>
                  {x.url ? (
                    <>
                      <span className="os-bb-strong">
                        {x.label ?? shortUrl(x.url)}
                        {x.resourceId ? <span className="os-bb-sub"> · resource</span> : null}
                      </span>
                      {x.label ? <span className="os-bb-sub">{shortUrl(x.url)}</span> : null}
                    </>
                  ) : (
                    <span className="os-bb-warn">Pick a resource or link</span>
                  )}
                </div>
              )
            )}
            {b.followupTemplate ? (
              <div className="os-bb-bubble" data-followup>
                <span className="os-bb-sub">Then, after {b.followupDelayMin} min:</span> {b.followupTemplate}
              </div>
            ) : null}
          </div>
          <span className="os-bb-sub">
            {data.perPerson} {data.perPerson === 1 ? "message" : "messages"} per person
          </span>
        </div>
      }
    >
      <div className="os-bb-form">
        <ol className="os-bb-edit-list">
          {bubbles.map((x, i) => (
            <li key={i} className="os-bb-edit">
              <div className="os-bb-edit-main">
                {x.type === "text" ? (
                  <textarea
                    className="os-textarea"
                    rows={Math.max(1, Math.ceil(x.text.length / 60))}
                    value={x.text}
                    placeholder="Hey {first_name}, …"
                    aria-label={`Message ${i + 1}`}
                    onChange={(e) => set(i, { type: "text", text: e.target.value })}
                  />
                ) : x.url ? (
                  <div className="os-bb-bubble" data-link>
                    <span className="os-bb-strong">{x.label ?? shortUrl(x.url)}</span>
                    {x.label ? <span className="os-bb-sub">{shortUrl(x.url)}</span> : null}
                  </div>
                ) : (
                  <div className="os-bb-linkfill">
                    <button type="button" className="os-button" onClick={() => setPicking(picking === i ? null : i)}>
                      Pick a resource
                    </button>
                    <input
                      className="os-input"
                      type="url"
                      placeholder="or paste a link"
                      aria-label="Paste a link"
                      autoFocus
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v) set(i, { type: "link", url: v, resourceId: null, label: null });
                      }}
                    />
                  </div>
                )}
                <span className="os-bb-tools">
                  <button type="button" className="os-bc-quiet" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button type="button" className="os-bc-quiet" aria-label="Move down" disabled={i === bubbles.length - 1} onClick={() => move(i, 1)}>
                    ↓
                  </button>
                  {x.type === "link" && x.url ? (
                    <button type="button" className="os-bc-quiet" onClick={() => set(i, { type: "link", url: null, resourceId: null, label: null })}>
                      Change
                    </button>
                  ) : null}
                  <button type="button" className="os-bc-quiet" aria-label="Remove" onClick={() => remove(i)}>
                    ✕
                  </button>
                </span>
              </div>
              {picking === i ? (
                <ResourcePicker
                  resources={resources}
                  onClose={() => setPicking(null)}
                  onPick={(r) => {
                    set(i, { type: "link", url: r.link, resourceId: r.id, label: r.name });
                    setPicking(null);
                  }}
                />
              ) : null}
            </li>
          ))}
        </ol>
        <div className="os-bb-row os-bb-adds">
          <button type="button" className="os-button" onClick={() => setBubbles((all) => [...all, { type: "text", text: "" }])}>
            + Message
          </button>
          <button type="button" className="os-button" onClick={() => addLink(true)}>
            Pick a resource
          </button>
          <button type="button" className="os-button" onClick={() => addLink(false)}>
            Paste a link
          </button>
          <button type="button" className="os-button" aria-pressed={fuOn} onClick={() => setFuOn((v) => !v)}>
            Then, after N minutes…
          </button>
        </div>
        {fuOn ? (
          <div className="os-bb-fu">
            <label className="os-bb-row">
              <span className="os-bb-sub">Then, after</span>
              <input className="os-input os-bb-num" type="number" min={1} max={240} value={delay} onChange={(e) => setDelay(Number(e.target.value))} aria-label="Minutes" />
              <span className="os-bb-sub">minutes</span>
            </label>
            <textarea className="os-textarea" rows={1} value={fu} onChange={(e) => setFu(e.target.value)} aria-label="Follow-up" placeholder="no pressure, curious what you think" />
          </div>
        ) : null}
        <Actions onCancel={() => setEditing(false)} onSave={save} pending={pending} />
      </div>
    </Step>
  );
}

function PersonaliseStep({ data, setters, act, pending, canEdit }: { data: BroadcastPage; setters: { id: string; name: string; isDefault: boolean }[]; act: Act; pending: boolean; canEdit: boolean }) {
  const ask = useContext(AskContext);
  const b = data.broadcast;
  const def = setters.find((s) => s.isDefault) ?? setters[0];
  const current = setters.find((s) => s.id === b.setterId) ?? def;
  const [editing, setEditing] = useState(false);
  const [setterId, setSetterId] = useState(current?.id ?? "");
  const [mode, setMode] = useState<PersonaliseMode>(b.personaliseMode);
  const [vars, setVars] = useState(b.variations.map((v) => v.join("\n")));
  const save = () =>
    saveStep(
      act,
      ask,
      b.key,
      {
        // The default stays "default" (null) unless another agent is picked.
        setterId: b.setterId === null && setterId === def?.id ? null : setterId || null,
        personaliseMode: mode,
        ...(mode === "variations" && vars.length ? { variations: vars.map((v) => v.split("\n").map((x) => x.trim()).filter(Boolean)) } : {}),
      },
      () => setEditing(false)
    );
  const info = MODES.find((m) => m.mode === b.personaliseMode)!;
  return (
    <Step
      n={4}
      label="Personalise"
      editing={editing}
      canEdit={canEdit}
      onEdit={() => setEditing(true)}
      summary={
        <div className="os-bb-sum">
          <span className="os-bb-row">
            <span className="os-bb-sub">Writes as</span>
            <span className="os-bb-agent">
              <span className="os-bb-agent-mark" aria-hidden="true">
                {(current?.name ?? "J")[0]}
              </span>
              {current?.name ?? "J"}
            </span>
          </span>
          <span className="os-bb-strong">{info.name}</span>
          <span className="os-bb-sub">{info.sub}</span>
          {b.personaliseMode === "variations" && b.variations.length ? (
            <ol className="os-bb-vars">
              {b.variations.map((v, i) => (
                <li key={i}>{v.join(" / ")}</li>
              ))}
            </ol>
          ) : null}
        </div>
      }
    >
      <div className="os-bb-form">
        <label className="os-bb-row">
          <span className="os-bb-sub">Writes as</span>
          <span className="os-select">
            <select value={setterId} onChange={(e) => setSetterId(e.target.value)} aria-label="Agent">
              {setters.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
          </span>
        </label>
        <div className="os-bb-modes" role="radiogroup" aria-label="How J personalises">
          {MODES.map((m) => (
            <button key={m.mode} type="button" role="radio" aria-checked={mode === m.mode} className="os-bb-mode" onClick={() => setMode(m.mode)}>
              <span className="os-bb-strong">{m.name}</span>
              <span className="os-bb-sub">{m.sub}</span>
            </button>
          ))}
        </div>
        {mode === "variations" && vars.length ? (
          <div className="os-bb-varedit">
            {vars.map((v, i) => (
              <textarea key={i} className="os-textarea" rows={2} value={v} aria-label={`Variation ${i + 1}`} onChange={(e) => setVars((all) => all.map((x, j) => (j === i ? e.target.value : x)))} />
            ))}
          </div>
        ) : null}
        <Actions onCancel={() => setEditing(false)} onSave={save} pending={pending} />
      </div>
    </Step>
  );
}

// ---------------------------------------------------------------- review

function stateLabel(m: ReviewItem, tz: string): string | null {
  switch (m.status) {
    case "approved":
      return "Approved";
    case "scheduled":
      return `Scheduled ${m.scheduledAt ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(m.scheduledAt)) : ""}`;
    case "sent":
      return "Sent";
    case "skipped":
      // After Send, a not-sent reason says why (the "approved, not sent" list below).
      if (m.skipReason && NOT_SENT_REASONS.includes(m.skipReason)) return `Not sent · ${SKIP_LABEL[m.skipReason]}`;
      return m.skipReason ? SKIP_LABEL[m.skipReason] : "Skipped";
    case "failed":
      return "Failed";
    case "outside_window":
      return "Outside window";
    default:
      return null;
  }
}

function DraftCard({ m, b, act, pending, locked }: { m: ReviewItem; b: BroadcastPage["broadcast"]; act: Act; pending: boolean; locked: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.text.join("\n"));
  const [fu, setFu] = useState(m.followupBubbles.join("\n"));
  const sendMyself = m.conversationId ? `/os/inbox?c=${encodeURIComponent(m.conversationId)}&bm=${encodeURIComponent(m.id)}` : null;
  const state = stateLabel(m, b.timezone);
  return (
    <article className="os-bb-draft" data-status={m.status}>
      <div className="os-bb-draft-head">
        <span className="os-bb-av" aria-hidden="true">
          {m.initial}
        </span>
        <span className="os-bb-strong">{m.handle}</span>
        <span className="os-bb-sub">{m.why}</span>
        {state ? <Pill tone={m.status === "sent" || m.status === "approved" ? "good" : m.status === "failed" ? "bad" : "neutral"}>{state}</Pill> : null}
      </div>
      {editing ? (
        <div className="os-bb-form">
          <textarea className="os-textarea" rows={Math.max(2, text.split("\n").length)} value={text} onChange={(e) => setText(e.target.value)} aria-label={`Message to ${m.handle}`} />
          {m.followupBubbles.length ? <textarea className="os-textarea" rows={1} value={fu} onChange={(e) => setFu(e.target.value)} aria-label={`Follow-up to ${m.handle}`} /> : null}
          <Actions onCancel={() => setEditing(false)} onSave={() => act(() => editMessageAction(b.key, m.id, { text, followup: fu }), () => setEditing(false))} pending={pending} />
        </div>
      ) : (
        <div className="os-bb-draft-body">
          {m.text.map((t, i) => (
            <p key={i}>{t}</p>
          ))}
          {m.links.map((l) => (
            <p key={l} className="os-bb-link">
              {shortUrl(l)}
            </p>
          ))}
          {m.followupBubbles.map((t, i) => (
            <p key={`f${i}`} className="os-bb-sub">
              Then: {t}
            </p>
          ))}
          {m.error && m.status !== "drafted" && m.status !== "approved" ? <p className="os-bb-warn">{m.error}</p> : null}
        </div>
      )}
      {!locked && !editing && (m.status === "drafted" || m.status === "approved") ? (
        <div className="os-bb-draft-acts">
          {m.status === "drafted" ? (
            <button type="button" className="os-button primary" disabled={pending} onClick={() => act(() => approveMessageAction(b.key, m.id, true))}>
              Approve
            </button>
          ) : (
            <button type="button" className="os-button" disabled={pending} onClick={() => act(() => approveMessageAction(b.key, m.id, false))}>
              Undo
            </button>
          )}
          <button type="button" className="os-button" disabled={pending} onClick={() => setEditing(true)}>
            Edit
          </button>
          <button type="button" className="os-button" disabled={pending} onClick={() => act(() => skipMessageAction(b.key, m.id, true))}>
            Skip
          </button>
          {b.personaliseMode === "per_person" && m.status === "drafted" ? (
            <button type="button" className="os-bc-quiet" disabled={pending} onClick={() => act(() => redraftOneAction(b.key, m.id))}>
              Regenerate
            </button>
          ) : null}
          {sendMyself ? (
            <Link href={sendMyself} className="os-bc-quiet os-bb-myself">
              Send myself
            </Link>
          ) : null}
        </div>
      ) : null}
      {!locked && m.status === "skipped" && !m.skipReason ? (
        <div className="os-bb-draft-acts">
          <button type="button" className="os-bc-quiet" disabled={pending} onClick={() => act(() => skipMessageAction(b.key, m.id, false))}>
            Put back
          </button>
        </div>
      ) : null}
    </article>
  );
}

type Filter = "check" | "approved" | "skipped" | "mine" | "all";

const sentByYou = (m: ReviewItem) => m.status === "skipped" && m.skipReason === "sent_by_kevin";
const skippedOnly = (m: ReviewItem) => m.status === "skipped" && m.skipReason !== "sent_by_kevin";
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Review({ data, act, pending }: { data: BroadcastPage; act: Act; pending: boolean }) {
  const b = data.broadcast;
  const review = data.review;
  const inReview = b.status === "in_review";
  const [filter, setFilter] = useState<Filter>(inReview ? "check" : "all");
  const [hadOpen, setHadOpen] = useState(true);
  const items = review?.items ?? [];
  const open = items.filter((m) => !m.collapsed);
  const had = items.filter((m) => m.collapsed);
  // Every person shows in exactly one count, so the counts add up.
  const counts = {
    check: open.filter((m) => m.status === "drafted").length,
    approved: open.filter((m) => m.status === "approved").length,
    skipped: open.filter(skippedOnly).length,
    mine: open.filter(sentByYou).length,
    scheduled: open.filter((m) => m.status === "scheduled").length,
    sent: open.filter((m) => m.status === "sent").length,
    notSent: open.filter((m) => m.status === "failed" || m.status === "outside_window" || Boolean(m.skipReason && NOT_SENT_REASONS.includes(m.skipReason))).length,
    plainSkipped: open.filter((m) => skippedOnly(m) && !(m.skipReason && NOT_SENT_REASONS.includes(m.skipReason))).length,
  };
  const shown = open.filter((m) =>
    filter === "check" ? m.status === "drafted" : filter === "approved" ? m.status === "approved" : filter === "skipped" ? skippedOnly(m) : filter === "mine" ? sentByYou(m) : true
  );
  const summary = (
    inReview
      ? [plural(counts.check, "to check", "to check"), `${counts.approved} approved`, counts.skipped ? `${counts.skipped} skipped` : null, counts.mine ? `${counts.mine} sent by you` : null]
      : [
          counts.sent + counts.mine ? `${counts.sent + counts.mine} sent${counts.mine ? ` (${counts.mine} by you)` : ""}` : null,
          counts.scheduled ? `${counts.scheduled} scheduled` : null,
          counts.notSent ? `${counts.notSent} not sent` : null,
          counts.plainSkipped ? `${counts.plainSkipped} skipped` : null,
        ]
  )
    .filter(Boolean)
    .join(" · ");
  const plan = review?.plan;
  const notSentTotal = data.notSent.reduce((n, g) => n + g.people.length, 0);
  const canMake = b.status === "draft" || (b.status === "cancelled" && !items.length);
  // Why Make drafts is off, said next to it (never a button that does nothing).
  const noWho = !b.audienceTagId && !b.contactIds.length;
  const noWords = !b.bubbles.some((x) => (x.type === "text" ? x.text.trim() : Boolean(x.url)));
  const makeBlock = noWho ? "Pick who gets it first." : data.who?.total === 0 ? "No one has this tag" : noWords ? "Write a message first." : data.emptyLink ? "Pick a resource or paste a link first." : null;

  return (
    <li className="os-bb-step os-bb-review">
      <div className="os-bb-rail" aria-hidden="true">
        <span className="os-bb-n">5</span>
      </div>
      <section className="os-card os-bb-card" aria-labelledby="bb-review">
        <div className="os-bb-card-head">
          <div>
            <h2 id="bb-review" className="os-bb-label">
              Review
            </h2>
            {review ? (
              <p className="os-bb-sub">
                {summary}
                {had.length ? ` · ${had.length} already had this link` : ""}
              </p>
            ) : null}
          </div>
          {inReview && open.length ? (
            <div className="os-segmented os-bb-filter" role="group" aria-label="Filter">
              <button type="button" aria-pressed={filter === "check"} onClick={() => setFilter("check")}>
                To check {counts.check}
              </button>
              <button type="button" aria-pressed={filter === "approved"} onClick={() => setFilter("approved")}>
                Approved {counts.approved}
              </button>
              <button type="button" aria-pressed={filter === "skipped"} onClick={() => setFilter("skipped")}>
                Skipped {counts.skipped}
              </button>
              {counts.mine ? (
                <button type="button" aria-pressed={filter === "mine"} onClick={() => setFilter("mine")}>
                  Sent by you {counts.mine}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {canMake ? (
          <div className="os-bb-make">
            <button type="button" className="os-button primary" disabled={pending || Boolean(makeBlock) || b.status === "cancelled"} onClick={() => act(() => makeDraftsAction(b.key))}>
              Make drafts
            </button>
            {makeBlock ? <span className="os-bb-warn">{makeBlock}</span> : null}
          </div>
        ) : null}

        {data.drafting ? (
          <p className="os-bb-progress" aria-live="polite">
            Drafting {data.drafting.done} of {data.drafting.total} · you can leave this page
          </p>
        ) : null}

        {data.failedDrafts.length ? (
          <div className="os-bb-failed os-well">
            <span className="os-bb-strong">Couldn&apos;t draft {data.failedDrafts.length}</span>
            {data.failedDrafts.map((m) => (
              <div key={m.id} className="os-bb-row">
                <span>{m.handle}</span>
                <span className="os-bb-sub">{m.error}</span>
                {inReview ? (
                  <button type="button" className="os-bc-quiet" disabled={pending} onClick={() => act(() => redraftOneAction(b.key, m.id))}>
                    Retry
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {inReview && counts.check ? (
          <div className="os-bb-row">
            <button type="button" className="os-bc-quiet" disabled={pending} onClick={() => act(() => approveAllAction(b.key))}>
              Approve all {counts.check}
            </button>
          </div>
        ) : null}

        <div className="os-bb-drafts">
          {shown.map((m) => (
            <DraftCard key={`${m.id}:${m.status}:${m.bubbles.join("|")}`} m={m} b={b} act={act} pending={pending} locked={!inReview} />
          ))}
        </div>

        {had.length ? (
          <div className="os-bb-had os-well">
            <button type="button" className="os-bb-had-head" aria-expanded={hadOpen} onClick={() => setHadOpen((v) => !v)}>
              <span>
                Already had this link <span className="os-bb-sub">· {had.length} · not approved, won&apos;t send</span>
              </span>
              <span className="os-bb-sub">{hadOpen ? "Hide" : "Show"}</span>
            </button>
            {hadOpen
              ? had.map((m) => (
                  <div key={m.id} className="os-bb-row">
                    <span>{m.handle}</span>
                    <span className="os-bb-sub">{m.hadWhen}</span>
                    {inReview ? (
                      <button type="button" className="os-bc-quiet" disabled={pending} onClick={() => act(() => includeAnywayAction(b.key, m.id, true))}>
                        Include anyway
                      </button>
                    ) : null}
                  </div>
                ))
              : null}
          </div>
        ) : null}

        {notSentTotal ? (
          <div className="os-bb-notsent os-well">
            <span className="os-bb-strong">{notSentTotal} approved, not sent</span>
            {data.notSent.map((g) => (
              <div key={g.reason} className="os-bb-row">
                <span>{g.label}</span>
                <span className="os-bb-sub">{g.people.map((p) => p.handle).join(", ")}</span>
                {g.reason === "wrote_since_drafting" && b.status === "sent" ? (
                  <button type="button" className="os-bc-quiet" disabled={pending} onClick={() => act(() => redraftWroteSinceAction(b.key))}>
                    Redraft
                  </button>
                ) : null}
              </div>
            ))}
            <div className="os-bb-actions">
              <button type="button" className="os-button" disabled={pending} onClick={() => act(() => newToUnsentAction(b.key))}>
                New broadcast to these {notSentTotal}
              </button>
            </div>
          </div>
        ) : null}

        {!inReview && review && data.progress.sent + data.progress.sentByYou + data.progress.cancelled + data.progress.scheduled ? (
          <p className="os-bb-sub">
            Sent {data.progress.sent + data.progress.sentByYou}
            {data.progress.scheduled ? ` · ${data.progress.scheduled} to go` : ""}
            {data.progress.cancelled ? ` · cancelled ${data.progress.cancelled}` : ""}
          </p>
        ) : null}

        {inReview && plan ? (
          <div className="os-bb-sendbar">
            <div className="os-bb-sum">
              <span className="os-bb-sub">
                {plan.figures.planned} messages planned · {plan.figures.left} left today
              </span>
              {b.startMode === "now" && plan.approved && !plan.figures.full ? (
                <span className="os-bb-sub">
                  About {plan.figures.fit} {plan.figures.fit === 1 ? "person fits" : "people fit"} before {b.windowEnd}
                  {plan.figures.extendTo ? (
                    <>
                      {" · "}
                      <button type="button" className="os-bc-quiet" disabled={pending} onClick={() => act(() => extendEndAction(b.key, plan.figures.extendTo!))}>
                        Extend end time
                      </button>
                    </>
                  ) : null}
                </span>
              ) : null}
              {plan.warning ? <span className="os-bb-warn">{plan.warning}</span> : null}
              {plan.blocked ? <span className="os-bb-warn">{plan.blocked}</span> : null}
            </div>
            <button type="button" className="os-button primary" disabled={pending || Boolean(plan.blocked)} onClick={() => act(() => sendAction(b.key))}>
              {plan.label}
            </button>
          </div>
        ) : null}
      </section>
    </li>
  );
}

// ---------------------------------------------------------------- the page

export default function BroadcastBuilder({
  data,
  setters,
  tags,
  resources,
}: {
  data: BroadcastPage;
  setters: { id: string; name: string; isDefault: boolean }[];
  tags: { id: string; name: string }[];
  resources: PickerResource[];
}) {
  const b = data.broadcast;
  const router = useRouter();
  const { pending, msg, setMsg, act, actQuiet } = useAct();
  const [name, setName] = useState(b.name);
  const [asking, setAsking] = useState<Question | null>(null);
  // A notice belongs to the moment it was made: a new status clears it.
  const [shownStatus, setShownStatus] = useState(b.status);
  if (shownStatus !== b.status) {
    setShownStatus(b.status);
    setMsg(null);
  }
  const canEdit = b.status === "draft" || b.status === "in_review" || (b.status === "cancelled" && !data.review);
  const live = b.status === "scheduled" || b.status === "sending";

  // Drafting runs in the background: refresh until it's done.
  useEffect(() => {
    if (b.status !== "drafting") return;
    const t = window.setInterval(() => router.refresh(), 2000);
    return () => window.clearInterval(t);
  }, [b.status, router]);

  // Each step's form remounts only when its own saved fields change, so saving
  // one step never throws away unsaved typing in another.
  const stamps = stepStamps(b);
  const saveName = () => {
    if (name.trim() && name !== b.name) actQuiet(() => saveStepsAction(b.key, { name }));
  };

  return (
    <div className="os-bb">
      <header className="os-bb-head">
        <div className="os-bb-titles">
          <nav aria-label="Breadcrumb" className="os-bb-crumbs">
            <Link href="/os/automations/broadcasts">Automations › Broadcasts</Link>
          </nav>
          <div className="os-bb-titlerow">
            <input
              className="os-bb-name os-title"
              value={name}
              aria-label="Broadcast name"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              onBlur={saveName}
            />
            <Pill tone={data.status.tone}>{data.status.label}</Pill>
          </div>
        </div>
        <div className="os-bb-head-acts">
          <button type="button" className="os-button" disabled={pending} onClick={() => act(() => duplicateAction(b.key))}>
            Duplicate
          </button>
          {b.status === "cancelled" ? (
            data.progress.sent === 0 && data.progress.cancelled === 0 ? (
              <button type="button" className="os-button" disabled={pending} onClick={() => act(() => reopenAction(b.key))}>
                Reopen
              </button>
            ) : null
          ) : b.status !== "sent" ? (
            <button
              type="button"
              className="os-button"
              disabled={pending}
              onClick={() =>
                setAsking({
                  text: live ? "Cancel the rest of this broadcast? What's sent stays sent." : "Cancel this broadcast? Drafts are kept.",
                  yes: "Cancel broadcast",
                  no: "Keep it",
                  onYes: () => act(() => cancelAction(b.key)),
                })
              }
            >
              Cancel broadcast
            </button>
          ) : null}
        </div>
      </header>

      {asking ? <ConfirmBar q={asking} pending={pending} onClose={() => setAsking(null)} /> : null}

      {msg ? (
        <div className="os-tl-msg" data-bad={msg.bad || undefined} role="status">
          {msg.text}
        </div>
      ) : null}

      <AskContext.Provider value={setAsking}>
        <ol className="os-bb-steps">
          <StartStep key={stamps.start} data={data} act={act} pending={pending} canEdit={canEdit} />
          <WhoStep key={stamps.who} data={data} tags={tags} act={act} pending={pending} canEdit={canEdit} />
          <MessagesStep key={stamps.messages} data={data} resources={resources} act={act} pending={pending} canEdit={canEdit} />
          <PersonaliseStep key={stamps.personalise} data={data} setters={setters} act={act} pending={pending} canEdit={canEdit} />
          <Review data={data} act={act} pending={pending} />
        </ol>
      </AskContext.Provider>

      {data.earlier.length ? (
        <section className="os-card os-bb-earlier" aria-labelledby="bb-earlier">
          <h2 id="bb-earlier" className="os-bb-label">
            Earlier sends
          </h2>
          <ul>
            {data.earlier.map((e) => (
              <li key={e.key}>
                <Link href={`/os/automations/broadcasts/${e.key}`}>{e.name}</Link>
                <span className="os-bb-sub">{e.date}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
