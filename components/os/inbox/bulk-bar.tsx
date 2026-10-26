"use client";

// The inbox's bulk bar (dm-crm 014): the shared bar (components/os/ui/bulk-bar)
// sticky at the bottom of the thread list once a row is ticked. Tag / untag
// (the tag writer), Won (the Won picker) or Lost (the stage writer), Archive
// or Restore, and Mark spam / Not spam (sticky). The list shows the toast, so
// it stays up after the selection clears.

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { archiveThreads, inboxSelectionTags, inboxTagOptions, markThreadsSpam, moveThreadsStage, tagThreads, type StreamActionResult } from "@/app/(os)/os/inbox/stream-actions";
import { undoContactsWon } from "@/app/(os)/os/contacts/actions";
import WonPicker from "@/components/os/contacts/won-picker";
import { BulkBar, type ToastMessage } from "@/components/os/ui";
import type { StatusFilter } from "@/lib/os/inbox-stream";

interface Props {
  ids: string[];
  /** "maya.builds" when one is picked. */
  oneName: string | null;
  filter: StatusFilter;
  allPicked: boolean;
  onAll: (on: boolean) => void;
  onDone: () => void;
  toast: (m: ToastMessage) => void;
}

export default function InboxBulkBar({ ids, oneName, filter, allPicked, onAll, onDone, toast }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tags, setTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[][]>([]);
  const [winning, setWinning] = useState(false);
  const key = ids.join(",");

  useEffect(() => {
    let live = true;
    inboxTagOptions()
      .then((t) => live && setTags(t.map((x) => x.name)))
      .catch(() => null);
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    inboxSelectionTags(ids)
      .then((t) => live && setSelectedTags(t))
      .catch(() => null);
    return () => {
      live = false;
    };
    // The selection, not the array's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const act = (fn: () => Promise<StreamActionResult>, undo?: () => Promise<StreamActionResult>) =>
    start(async () => {
      const r = await fn().catch(() => ({ error: "That didn't save. Try again." }) as StreamActionResult);
      if (r.error) return toast({ text: r.error, bad: true });
      toast({
        text: r.notice ?? "Done.",
        undo: undo
          ? () =>
              start(async () => {
                const u = await undo().catch(() => ({ error: "That didn't undo." }) as StreamActionResult);
                toast(u.error ? { text: u.error, bad: true } : { text: "Undone." });
                router.refresh();
              })
          : undefined,
      });
      onDone();
      router.refresh();
    });

  const list = ids;
  return (
    <>
      <BulkBar
        className="os-ix-bulk"
        count={ids.length}
        all={{ checked: allPicked, onChange: onAll }}
        tags={tags}
        selectedTags={selectedTags}
        pending={pending}
        onAddTag={(tag) => {
          const fresh = list.filter((_, i) => !(selectedTags[i] ?? []).includes(tag));
          act(() => tagThreads(list, tag, "add"), () => tagThreads(fresh.length ? fresh : list, tag, "remove"));
        }}
        onRemoveTag={(tag) => {
          const had = list.filter((_, i) => (selectedTags[i] ?? []).includes(tag));
          act(() => tagThreads(list, tag, "remove"), () => tagThreads(had.length ? had : list, tag, "add"));
        }}
        onWon={() => setWinning(true)}
        onLost={() => act(() => moveThreadsStage(list, "LOST"))}
        archived={filter === "archived"}
        onArchive={(archived) => act(() => archiveThreads(list, archived), () => archiveThreads(list, !archived))}
        onClear={() => onAll(false)}
        extra={
          filter === "spam" ? (
            <button type="button" className="os-button" disabled={pending} onClick={() => act(() => markThreadsSpam(list, false), () => markThreadsSpam(list, true))}>
              Not spam
            </button>
          ) : (
            <button type="button" className="os-button ghost" disabled={pending} onClick={() => act(() => markThreadsSpam(list, true), () => markThreadsSpam(list, false))}>
              Mark spam
            </button>
          )
        }
      />
      {winning ? (
        <WonPicker
          contactIds={list}
          who={list.length === 1 ? (oneName ?? "them") : `${list.length} people`}
          onClose={() => setWinning(false)}
          onDone={(w) => {
            setWinning(false);
            toast({
              text: w.refused.length ? `Marked ${w.count} as Won. ${w.refused.length} couldn't move: ${w.refused[0]}` : `Marked ${w.count} as Won${w.amount === null ? " with no amount" : ""}.`,
              undo: () =>
                start(async () => {
                  await undoContactsWon(list, w.promoted).catch(() => null);
                  toast({ text: "Undid Won." });
                  router.refresh();
                }),
            });
            onDone();
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
