"use client";

// The Follow-ups queue: J's nudges on top, the Friday list below. Every send
// is a person pressing a button (approve-only, spec item 9).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { approveNudge, draftNudge, sendFriday, sendFridayBatch, setOnFriday, skipNudge, snoozeNudge } from "@/app/(os)/os/follow-ups/actions";
import Avatar from "@/components/os/inbox/avatar";
import { initialSource, threadName } from "@/components/os/inbox/names";
import type { FollowupsData } from "@/lib/os/followups-data";
import type { FridayItem, FridayResource, NudgeItem } from "@/lib/os/followups";

interface Props {
  data: FollowupsData;
  now: number;
}

/** "in 5h", "2h ago", "now". */
function rel(iso: string | null, now: number): string {
  if (!iso) return "";
  const mins = Math.round((new Date(iso).getTime() - now) / 60000);
  const abs = Math.abs(mins);
  const s = abs < 60 ? `${abs}m` : abs < 60 * 24 ? `${Math.round(abs / 60)}h` : `${Math.round(abs / 1440)}d`;
  if (abs < 2) return "now";
  return mins > 0 ? `in ${s}` : `${s} ago`;
}

function longDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

function threadHref(conversationId: string | null) {
  return conversationId ? `/os/inbox?tab=sales&c=${encodeURIComponent(conversationId)}` : null;
}

function Who({ item }: { item: { username: string | null; fullName: string | null; avatarUrl: string | null; conversationId: string | null } }) {
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

export default function FollowupsScreen({ data, now }: Props) {
  const due = data.nudges.filter((n) => n.status !== "soon").length;
  // A row can leave the queue after its action (sent, moved to the Inbox): its message shows here.
  const [flash, setFlash] = useState<string | null>(null);
  return (
    <div className="os-fu">
      {/* J's value openers (and the old single nudge, where sequences don't run). */}
      {(data.nudges.length > 0 || flash) && (
        <section className="os-fu-section" aria-labelledby="fu-nudges">
          <header className="os-fu-section-head">
            <h2 id="fu-nudges">Value openers</h2>
            <span className="os-fu-count">{due ? `${due} ready or due` : "Nothing due"}</span>
          </header>
          {flash && (
            <p className="os-fu-notice os-fu-flash" role="status">
              {flash}
            </p>
          )}
          <p className="os-fu-lede">Lead magnets that went out and need J&apos;s first message. Never pushy.</p>
          {data.nudges.length === 0 ? (
            <div className="os-fu-empty">Nobody to nudge in the next 24 hours.</div>
          ) : (
            <ul className="os-fu-list">
              {data.nudges.map((n) => (
                <NudgeRow key={n.contactId} item={n} now={now} onFlash={setFlash} />
              ))}
            </ul>
          )}
        </section>
      )}

      <FridaySection data={data} now={now} />
    </div>
  );
}

// ---------------------------------------------------------------- nudges
const KIND: Record<NudgeItem["kind"], string> = { nudge: "Nudge", value_opener: "Value opener" };

function NudgeRow({ item, now, onFlash }: { item: NudgeItem; now: number; onFlash: (m: string | null) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ error?: string; notice?: string } | null>(null);
  const d = item.draft;

  function run(what: string, fn: () => Promise<{ error?: string; notice?: string }>) {
    setMsg(null);
    onFlash(null);
    setBusy(what);
    start(async () => {
      const r = await fn();
      if (r.error || r.notice) setMsg(r);
      if (r.notice) onFlash(r.notice);
      setBusy(null);
      router.refresh();
    });
  }

  const when = item.status === "drafted" ? "Draft ready" : `Due ${rel(item.at, now)}`;

  return (
    <li className="os-fu-row" data-status={item.status} aria-busy={pending}>
      <div className="os-fu-row-head">
        <Who item={item} />
        <span className="os-fu-chips">
          <span className="chip quiet">{KIND[item.kind]}</span>
          <span className={item.status === "soon" ? "chip quiet" : "chip ready"}>{when}</span>
          {item.window === "human_agent" && (
            <span className="chip flag" title="They last wrote over 24h ago: this goes out under Meta's HUMAN_AGENT tag.">
              Outside 24h
            </span>
          )}
          {d?.flags.includes("sample") && <span className="chip quiet">Sample draft</span>}
        </span>
      </div>

      {d && (
        <ol className="os-draft-bubbles os-fu-bubbles" aria-label="J's draft">
          {d.bubbles.map((b, i) => (
            <li key={i}>
              <span className="bubble">{b}</span>
            </li>
          ))}
        </ol>
      )}
      {d?.reasoning && (
        <details className="os-draft-why">
          <summary>Why this</summary>
          <p>{d.reasoning}</p>
        </details>
      )}

      {msg && (
        <p className={msg.error ? "os-fu-error" : "os-fu-notice"} role={msg.error ? "alert" : "status"}>
          {msg.error ?? msg.notice}
        </p>
      )}

      <div className="os-fu-actions">
        <label className="os-select os-fu-snooze">
          <span className="sr-only">Snooze</span>
          <select
            value=""
            disabled={pending}
            onChange={(e) => {
              const h = Number(e.target.value);
              if (h) run("snooze", () => snoozeNudge(item.contactId, h));
            }}
          >
            <option value="">{busy === "snooze" ? "Snoozing…" : "Snooze"}</option>
            <option value="4">4 hours</option>
            <option value="24">1 day</option>
            <option value="72">3 days</option>
          </select>
        </label>
        <button type="button" className="os-button ghost" disabled={pending} onClick={() => run("skip", () => skipNudge(item.contactId, d?.id ?? null, item.anchor))}>
          {busy === "skip" ? "Skipping…" : "Skip"}
        </button>
        {d ? (
          <button type="button" className="os-button primary" disabled={pending} onClick={() => run("approve", () => approveNudge(d.id))}>
            {busy === "approve" ? "Sending…" : d.bubbles.length > 1 ? `Approve & send ${d.bubbles.length}` : "Approve & send"}
          </button>
        ) : (
          <button type="button" className="os-button primary" disabled={pending} onClick={() => run("draft", () => draftNudge(item.contactId))}>
            {busy === "draft" ? "J is writing…" : item.kind === "value_opener" ? "Draft opener" : "Draft nudge"}
          </button>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- Friday
interface RowChoice {
  resourceId: string;
  note: string;
}

const WINDOW_LABEL: Record<FridayItem["window"], string> = {
  free: "In the 24h window",
  human_agent: "Outside 24h: sends as HUMAN_AGENT",
  closed: "Window closed",
  unknown: "Window checked when you send",
};

function FridaySection({ data, now }: Props) {
  const router = useRouter();
  const { items, resources, date, isToday } = data.friday;
  const bySlug = useMemo(() => new Map(resources.map((r) => [r.slug, r])), [resources]);
  const [choices, setChoices] = useState<Record<string, RowChoice>>(() =>
    Object.fromEntries(items.map((i) => [i.contactId, { resourceId: (i.suggested && bySlug.get(i.suggested)?.id) || "", note: data.defaultNote }]))
  );
  const [confirming, setConfirming] = useState(false);
  const [batchPending, startBatch] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [batchNote, setBatchNote] = useState<string | null>(null);

  const choiceOf = (i: FridayItem): RowChoice =>
    choices[i.contactId] ?? { resourceId: (i.suggested && bySlug.get(i.suggested)?.id) || "", note: data.defaultNote };
  const ready = items.filter((i) => i.status === "ready" && choiceOf(i).resourceId);
  const sentCount = items.filter((i) => i.status === "sent").length;

  function sendAll() {
    setBatchNote(null);
    startBatch(async () => {
      const results = await sendFridayBatch(ready.map((i) => ({ contactId: i.contactId, ...choiceOf(i) })));
      const errs = Object.fromEntries(results.filter((r) => r.error).map((r) => [r.contactId, r.error!]));
      setErrors(errs);
      const ok = results.length - Object.keys(errs).length;
      setBatchNote(`Sent ${ok} of ${results.length}.${Object.keys(errs).length ? " The rest show why below." : ""}`);
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <section className="os-fu-section" id="friday" aria-labelledby="fu-friday">
      <header className="os-fu-section-head">
        <h2 id="fu-friday">Follow-up Friday</h2>
        <span className="os-fu-count">
          {isToday ? "Today" : longDate(date)} · {items.length} {items.length === 1 ? "person" : "people"}
          {sentCount ? ` · ${sentCount} sent` : ""}
        </span>
      </header>
      <p className="os-fu-lede">
        One gift per person: a line, then a resource they haven&apos;t had. Add people with the Friday switch in Contacts or a thread. They stay on the list; next week they get the next resource.
      </p>

      {resources.length === 0 && (
        <div className="os-fu-empty">
          No active resource with a link yet. Add one in <Link href="/os/knowledge/resources">Knowledge bases → Resources</Link>.
        </div>
      )}

      {items.length === 0 ? (
        <div className="os-fu-empty">Nobody on the Friday list. Flip the Friday switch on a contact to add them.</div>
      ) : (
        <>
          {ready.length > 0 && (
            <div className="os-fu-batch" data-confirming={confirming || undefined}>
              {confirming ? (
                <>
                  <span>
                    Send {ready.length} {ready.length === 1 ? "message" : "messages"} now? Each goes out as its line, then the resource.
                  </span>
                  <span className="os-fu-batch-actions">
                    <button type="button" className="os-button ghost" disabled={batchPending} onClick={() => setConfirming(false)}>
                      Cancel
                    </button>
                    <button type="button" className="os-button primary" disabled={batchPending} onClick={sendAll}>
                      {batchPending ? "Sending…" : `Send ${ready.length}`}
                    </button>
                  </span>
                </>
              ) : (
                <>
                  <span>{ready.length} ready with a resource picked.</span>
                  <button type="button" className="os-button" onClick={() => setConfirming(true)}>
                    Send all {ready.length}
                  </button>
                </>
              )}
            </div>
          )}
          {batchNote && (
            <p className="os-fu-notice" role="status">
              {batchNote}
            </p>
          )}
          <ul className="os-fu-list">
            {items.map((i) => (
              <FridayRow
                key={i.contactId}
                item={i}
                now={now}
                resources={resources}
                choice={choiceOf(i)}
                batchError={errors[i.contactId] ?? null}
                disabled={batchPending}
                onChoice={(c) => setChoices((all) => ({ ...all, [i.contactId]: c }))}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function FridayRow({
  item,
  now,
  resources,
  choice,
  batchError,
  disabled,
  onChoice,
}: {
  item: FridayItem;
  now: number;
  resources: FridayResource[];
  choice: RowChoice;
  batchError: string | null;
  disabled: boolean;
  onChoice: (c: RowChoice) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"send" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canSend = item.status === "ready";
  const shownError = error ?? batchError;

  function run(what: "send" | "remove") {
    setError(null);
    setBusy(what);
    start(async () => {
      const r = what === "send" ? await sendFriday({ contactId: item.contactId, ...choice }) : await setOnFriday(item.contactId, false);
      if (r.error) setError(r.error);
      setBusy(null);
      router.refresh();
    });
  }

  return (
    <li className="os-fu-row" data-status={item.status} aria-busy={pending}>
      <div className="os-fu-row-head">
        <Who item={item} />
        <span className="os-fu-chips">
          {item.status === "sent" && item.sent && (
            <span className="chip ready">
              Sent {item.sent.slug}
              {item.sent.at ? ` · ${rel(item.sent.at, now)}` : ""}
            </span>
          )}
          {item.status === "ready" && item.window === "human_agent" && <span className="chip flag">Outside 24h</span>}
          {item.reason && <span className="chip quiet">{item.reason}</span>}
        </span>
      </div>

      {(canSend || item.had.length > 0) && (
        <p className="os-fu-meta">
          {[canSend ? WINDOW_LABEL[item.window] : null, item.had.length ? `Had ${item.had.join(", ")}` : null].filter(Boolean).join(" · ")}
        </p>
      )}

      {canSend && (
        <div className="os-fu-friday-form">
          <label className="os-select">
            <span className="sr-only">Resource for {threadName(item.username, item.fullName)}</span>
            <select value={choice.resourceId} disabled={pending || disabled} onChange={(e) => onChoice({ ...choice, resourceId: e.target.value })}>
              <option value="">Pick a resource</option>
              {resources.map((r) => {
                const had = item.had.includes(r.slug);
                return (
                  <option key={r.id} value={r.id} disabled={had}>
                    {r.name}
                    {had ? " (already had)" : ""}
                  </option>
                );
              })}
            </select>
          </label>
          <input
            className="os-input"
            aria-label="The line before the resource"
            placeholder="A line before the resource (optional)"
            maxLength={1000}
            value={choice.note}
            disabled={pending || disabled}
            onChange={(e) => onChoice({ ...choice, note: e.target.value })}
          />
        </div>
      )}

      {shownError && (
        <p className="os-fu-error" role="alert">
          {shownError}
        </p>
      )}

      <div className="os-fu-actions">
        <button type="button" className="os-button ghost" disabled={pending || disabled} onClick={() => run("remove")}>
          {busy === "remove" ? "Removing…" : "Remove from Friday"}
        </button>
        {canSend && (
          <button type="button" className="os-button primary" disabled={pending || disabled || !choice.resourceId} onClick={() => run("send")}>
            {busy === "send" ? "Sending…" : "Send"}
          </button>
        )}
      </div>
    </li>
  );
}
