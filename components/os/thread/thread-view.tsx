"use client";

// The conversation column (InboxA, and the Contacts panel's Chat tab): a
// fixed-height column anchored at the newest message, right above the
// composer. Older messages sit above, clipped under "Earlier messages", which
// scrolls up and then fetches the next older page. Owner: S1.

import { useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { loadEarlierMessages } from "@/app/(os)/os/inbox/actions";
import { MessageParts, Reactions } from "@/components/os/thread/parts";
import { Avatar, SetterMark } from "@/components/os/ui";
import type { ThreadData } from "@/lib/os/inbox";
import { buildThreadRows, mergeMessages, type ThreadRow } from "@/lib/os/messages/view";

const BOLT = "M9 2 4 9h4l-1 5 5-7H8l1-5Z";
const DOC = "M4 1.8h5.5L12.5 5v9.2H4V1.8ZM9.5 1.8V5h3";

interface ThreadViewProps {
  data: ThreadData;
  contactId: string | null;
  /** Their name for the avatar initial. */
  who: string;
  avatarUrl?: string | null;
  now: number;
}

export default function ThreadView({ data, contactId, who, avatarUrl = null, now }: ThreadViewProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [older, setOlder] = useState<ThreadData | null>(null);
  const [above, setAbove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const keepFromBottom = useRef<number | null>(null);

  // Older pages stay when the newest page refreshes (a send, a new reply).
  const messages = useMemo(() => mergeMessages(older?.messages ?? [], data.messages), [older, data.messages]);
  const cursor = older ? older.cursor : data.cursor;
  const extras = useMemo(
    () =>
      older
        ? {
            ...data.extras,
            media: { ...older.extras.media, ...data.extras.media },
            leadMagnetByMessage: { ...older.extras.leadMagnetByMessage, ...data.extras.leadMagnetByMessage },
            openerByAutomation: { ...older.extras.openerByAutomation, ...data.extras.openerByAutomation },
          }
        : data.extras,
    [older, data.extras]
  );
  const rows = useMemo(() => buildThreadRows(messages, extras, now, data.tz), [messages, extras, now, data.tz]);
  const newest = messages[messages.length - 1]?.id ?? null;

  // Open at the newest message, and stay there when one arrives.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (keepFromBottom.current !== null) {
      el.scrollTop = el.scrollHeight - keepFromBottom.current;
      keepFromBottom.current = null;
    } else {
      el.scrollTop = el.scrollHeight;
    }
    setAbove(el.scrollTop > 4);
  }, [newest, rows.length]);

  function earlier() {
    const el = scroller.current;
    if (!el) return;
    setError(null);
    if (el.scrollTop > 4) {
      el.scrollBy({ top: -el.clientHeight * 0.8, behavior: "smooth" });
      return;
    }
    if (!cursor) return;
    startLoad(async () => {
      const r = await loadEarlierMessages(data.conversationId, contactId, cursor);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      keepFromBottom.current = el.scrollHeight - el.scrollTop;
      setOlder((prev) => ({
        ...r,
        messages: mergeMessages(r.messages, prev?.messages ?? []),
        extras: prev
          ? {
              ...r.extras,
              media: { ...r.extras.media, ...prev.extras.media },
              leadMagnetByMessage: { ...r.extras.leadMagnetByMessage, ...prev.extras.leadMagnetByMessage },
              openerByAutomation: { ...r.extras.openerByAutomation, ...prev.extras.openerByAutomation },
            }
          : r.extras,
      }));
    });
  }

  const showEarlier = above || Boolean(cursor);

  return (
    <div className="os-th" aria-label="Messages">
      <div className="os-th-fade" aria-hidden="true" />
      {showEarlier ? (
        <button type="button" className="os-th-earlier" onClick={earlier} disabled={loading} aria-busy={loading}>
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m4 10 4-4 4 4" />
          </svg>
          {loading ? "Loading…" : "Earlier messages"}
        </button>
      ) : null}
      <div className="os-th-scroll" ref={scroller} onScroll={(e) => setAbove(e.currentTarget.scrollTop > 4)}>
        <div className="os-th-list">
          {error ? (
            <p className="os-th-error" role="alert">
              {error}
            </p>
          ) : null}
          {rows.length === 0 ? <p className="os-th-empty">No messages yet.</p> : null}
          {rows.map((r) => (
            <Row key={r.key} row={r} who={who} avatarUrl={avatarUrl} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ row, who, avatarUrl }: { row: ThreadRow; who: string; avatarUrl: string | null }) {
  if (row.kind === "time") return <div className="os-th-time">{row.label}</div>;
  const { message: m, side } = row;
  if (side === "in") {
    return (
      <div className="os-th-row" data-side="in">
        {row.avatar ? <Avatar name={who} src={avatarUrl} size={24} /> : <span className="os-th-av-gap" aria-hidden="true" />}
        <div className="os-th-stack">
          <Bubbles row={row} />
        </div>
      </div>
    );
  }
  return (
    <div className="os-th-row" data-side="out">
      <Bubbles row={row} />
      {row.opener ? (
        <span className="os-th-opener" title="Opener sent by OpenReply">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
            <path d={BOLT} />
          </svg>
          {row.opener}
        </span>
      ) : null}
      {row.foot ? (
        <span className="os-th-foot">
          {row.foot.seen ? <span>Seen</span> : null}
          {row.foot.leadMagnet ? (
            <span className="os-th-lm" title={`Lead magnet sent: ${row.foot.leadMagnet}`}>
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
                <path d={DOC} />
              </svg>
              {row.foot.leadMagnet}
            </span>
          ) : null}
          {row.foot.setter ? <SetterMark name={row.foot.setter} size={16} /> : null}
        </span>
      ) : null}
      {m.edited ? <span className="os-th-edited">Edited</span> : null}
    </div>
  );
}

function Bubbles({ row }: { row: Extract<ThreadRow, { kind: "message" }> }) {
  const m = row.message;
  if (!m.reactions.length) return <MessageParts m={m} media={row.media} />;
  return (
    <div className="os-th-reacted">
      <MessageParts m={m} media={row.media} />
      <Reactions m={m} />
    </div>
  );
}
