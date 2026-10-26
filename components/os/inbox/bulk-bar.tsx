"use client";

// The inbox's bulk bar (dm-crm 014): sticky at the bottom of the thread list
// once a row is ticked. Tag / untag (the tag writer), Won or Lost (the stage
// writer), Archive or Restore, and Mark spam / Not spam (sticky).

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { archiveThreads, inboxTagOptions, markThreadsSpam, moveThreadsStage, tagThreads, type StreamActionResult } from "@/app/(os)/os/inbox/stream-actions";
import type { StatusFilter } from "@/lib/os/inbox-stream";

interface Props {
  ids: string[];
  filter: StatusFilter;
  allPicked: boolean;
  onAll: (on: boolean) => void;
  onDone: () => void;
}

export default function InboxBulkBar({ ids, filter, allPicked, onAll, onDone }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tags, setTags] = useState<{ name: string; color: string }[]>([]);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    inboxTagOptions().then((t) => live && setTags(t)).catch(() => null);
    return () => {
      live = false;
    };
  }, []);

  const act = (fn: () => Promise<StreamActionResult>) =>
    start(async () => {
      const r = await fn().catch(() => ({ error: "That didn't save. Try again." }) as StreamActionResult);
      if (r.error) {
        setMsg({ text: r.error, bad: true });
        return;
      }
      setMsg(r.notice ? { text: r.notice } : null);
      onDone();
      router.refresh();
    });

  function onTag(v: string) {
    if (!v) return;
    const [op, ...rest] = v.split(":");
    const name = rest.join(":");
    act(() => tagThreads(ids, name, op === "remove" ? "remove" : "add"));
  }

  return (
    <div className="os-ix-bulk" role="region" aria-label="Bulk actions" aria-busy={pending || undefined}>
      <label className="os-ix-bulk-count">
        <input type="checkbox" className="os-ix-check" checked={allPicked} aria-label="Select all shown" onChange={(e) => onAll(e.target.checked)} />
        <strong>{ids.length}</strong> selected
      </label>
      <div className="os-ix-bulk-actions">
        <span className="os-select">
          <select aria-label="Tag" value="" disabled={pending} onChange={(e) => onTag(e.target.value)}>
            <option value="">Tag…</option>
            <optgroup label="Add">
              {tags.map((t) => (
                <option key={`a${t.name}`} value={`add:${t.name}`}>
                  {t.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Remove">
              {tags.map((t) => (
                <option key={`r${t.name}`} value={`remove:${t.name}`}>
                  {t.name}
                </option>
              ))}
            </optgroup>
          </select>
        </span>
        <span className="os-select">
          <select
            aria-label="Won or Lost"
            value=""
            disabled={pending}
            onChange={(e) => e.target.value && act(() => moveThreadsStage(ids, e.target.value as "WON" | "LOST"))}
          >
            <option value="">Won / Lost…</option>
            <option value="WON">Won</option>
            <option value="LOST">Lost</option>
          </select>
        </span>
        {filter === "archived" ? (
          <button type="button" className="os-button" disabled={pending} onClick={() => act(() => archiveThreads(ids, false))}>
            Restore
          </button>
        ) : (
          <button type="button" className="os-button" disabled={pending} onClick={() => act(() => archiveThreads(ids, true))}>
            Archive
          </button>
        )}
        {filter === "spam" ? (
          <button type="button" className="os-button" disabled={pending} onClick={() => act(() => markThreadsSpam(ids, false))}>
            Not spam
          </button>
        ) : (
          <button type="button" className="os-button ghost" disabled={pending} onClick={() => act(() => markThreadsSpam(ids, true))}>
            Mark spam
          </button>
        )}
        <button type="button" className="os-ix-iconbtn" aria-label="Clear selection" title="Clear selection" onClick={() => onAll(false)}>
          ×
        </button>
      </div>
      {msg ? (
        <p className="os-ix-bulk-msg" role="status" data-bad={msg.bad || undefined}>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
