"use client";

// Pipeline (dm-crm issue 019, Pipeline + PhonePipeline boards): one board per
// setter, picked in the switcher (with the "All · funnel" tab, Home's
// board). Drag a card to a column it may go to; select cards for Tag, Move
// selected…, Archive; Won asks for the offer; Undo Won on Won cards. Moves go
// through the stage writer (updateContacts → writeStage). Today's contact
// panel pushes in from the right.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import { undoContactsWon, undoContactWon, updateContacts } from "@/app/(os)/os/contacts/actions";
import PanelHost, {
  usePanel,
  type OpenPanel,
} from "@/components/os/contacts/panel-host";
import WonPicker from "@/components/os/contacts/won-picker";
import { threadName } from "@/components/os/inbox/names";
import { useOsCommand } from "@/components/os/keys";
import MoveSheet from "@/components/os/pipeline/setter-move-sheet";
import { BulkBar, Toast, useToast } from "@/components/os/ui";
import PipelineBoard from "@/components/os/pipeline/setter-board";
import { BoardSwitch } from "@/components/os/pipeline/board-switch";
import type { PanelTab } from "@/lib/os/contact-panel/types";
import type { ContactRow, SetterOption } from "@/lib/os/contacts-board";
import type { ContactChange } from "@/lib/os/contacts-edit";
import { applyChangeLocally } from "@/lib/os/contacts-filter";
import { matchesSearch } from "@/lib/os/contacts-view";
import {
  boardColumnsFor,
  boardLanes,
  moveLocally,
  onBoard,
  selectionTargets,
} from "@/lib/os/pipeline-board";

interface Props {
  contacts: ContactRow[];
  setters: SetterOption[];
  /** The board's setter id. */
  setterId: string;
  tags: string[];
  currency: string;
  truncated: boolean;
  now: number;
  focusKey?: string | null;
  initialOpen?: OpenPanel | null;
  initialTab?: PanelTab;
}

export default function PipelineScreen(p: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [rows, setRows] = useState(p.contacts);
  const [seen, setSeen] = useState(p.contacts);
  if (p.contacts !== seen) {
    setSeen(p.contacts);
    setRows(p.contacts);
  }
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [archived, setArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const [wonFor, setWonFor] = useState<string[] | null>(null);
  const [moving, setMoving] = useState(false);
  const toaster = useToast();
  const { show: showToast } = toaster;
  const onError = useCallback(
    (text: string) => setStatus({ text, error: true }),
    [],
  );
  const panel = usePanel(
    p.initialOpen ?? null,
    p.initialTab ?? "chat",
    onError,
  );

  const setter = p.setters.find((s) => s.id === p.setterId) ?? null;
  const defaultId =
    (p.setters.find((s) => s.isDefault) ?? p.setters[0])?.id ?? null;
  const columns = useMemo(
    () => boardColumnsFor(p.setters, p.setterId),
    [p.setters, p.setterId],
  );
  // The phone shows one column: the ?stage= one, else (until a tab is
  // tapped) the first column with people in it.
  const [phonePick, setPhoneColumn] = useState<string | null>(
    p.focusKey && columns.some((c) => c.key === p.focusKey) ? p.focusKey : null,
  );

  const onThisBoard = useMemo(
    () =>
      rows.filter(
        (c) =>
          c.kind === "SALES" &&
          (!setter || onBoard(c, setter.id, defaultId)) &&
          (archived ? Boolean(c.archivedAt) : !c.archivedAt) &&
          matchesSearch(c, query),
      ),
    [rows, setter, defaultId, archived, query],
  );
  const lanes = useMemo(
    () => boardLanes(onThisBoard, columns),
    [onThisBoard, columns],
  );
  const phoneColumn =
    phonePick ??
    lanes.find((l) => l.cards.length)?.column.key ??
    columns[0]?.key ??
    "";
  const picked = useMemo(
    () => onThisBoard.filter((c) => selected.has(c.id)),
    [onThisBoard, selected],
  );
  const n = picked.length;

  /** Show the change now, save it, and put it back if the save fails. */
  const save = useCallback(
    (
      ids: string[],
      change: ContactChange,
      local: (r: ContactRow[]) => ContactRow[],
      done?: string,
      undo?: () => void,
    ) => {
      let before: ContactRow[] = [];
      setRows((r) => {
        before = r;
        return local(r);
      });
      setStatus(null);
      if (done) showToast({ text: done, undo });
      startTransition(async () => {
        let error: string | undefined;
        try {
          error = (await updateContacts(ids, change)).error;
        } catch {
          error = "That didn't save. Try again.";
        }
        if (error) {
          setRows(before);
          showToast({ text: error, bad: true });
        } else if (panel.openId && ids.includes(panel.openId))
          panel.reload(panel.openId);
      });
    },
    [panel, showToast],
  );

  const move = useCallback(
    (ids: string[], to: string) => {
      if (!ids.length) return;
      if (to === "won") return setWonFor(ids);
      const label = columns.find((c) => c.key === to)?.label ?? to;
      const one = ids.length === 1 ? rows.find((r) => r.id === ids[0]) : null;
      const set = new Set(ids);
      save(
        ids,
        { type: "column", column: to },
        (r) => r.map((c) => (set.has(c.id) ? moveLocally(c, to, columns) : c)),
        `Moved ${one ? threadName(one.username, one.fullName) : ids.length} to ${label}.`,
      );
      if (ids.length > 1) setSelected(new Set());
    },
    [columns, rows, save],
  );

  // The panel's stage dropdown (event bus).
  useOsCommand("move-stage", (d) => {
    if (d.contactId && d.stage) move([d.contactId], d.stage);
  });

  function undoWon(id: string) {
    const c = rows.find((r) => r.id === id);
    startTransition(async () => {
      const r = await undoContactWon(id).catch(() => ({
        error: "That didn't save. Try again.",
      }));
      if ("error" in r) return showToast({ text: r.error, bad: true });
      setRows((all) =>
        all.map((x) =>
          x.id === id
            ? {
                ...x,
                stage: x.booking ? "CALL_BOOKED" : "IN_CONVERSATION",
                won: null,
              }
            : x,
        ),
      );
      showToast({
        text: `Undid Won for ${c ? threadName(c.username, c.fullName) : "them"}.`,
      });
      if (panel.openId === id) panel.reload(id);
      router.refresh();
    });
  }

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const ids = picked.map((c) => c.id);

  return (
    <div className="os-cx os-pl" data-panel={panel.open ? "open" : undefined}>
      <section className="os-cx-main" aria-labelledby="os-pl-h">
        <header className="os-cx-head">
          <h1 id="os-pl-h" className="os-title">
            Pipeline
          </h1>
          {setter ? <span className="os-cx-count">{setter.name}</span> : null}
          <span className="os-cx-grow" />
          <label className="os-cx-search">
            <span className="sr-only">Search the board</span>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" />
              <path d="m10.5 10.5 3 3" />
            </svg>
            <input
              type="search"
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <Link href="/os/contacts" className="os-button ghost os-cv-pipe">
            List view
          </Link>
        </header>

        <div className="os-pl-switch">
          <BoardSwitch setters={p.setters} value={p.setterId} />
          <label className="os-cv-archived">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            Archived
          </label>
        </div>

        <>
          <BulkBar
            className="os-cv-bulk"
            count={n}
            all={{
              checked: n > 0 && n === onThisBoard.length,
              onChange: (on) =>
                setSelected(on ? new Set(onThisBoard.map((c) => c.id)) : new Set()),
            }}
            tags={p.tags}
            selectedTags={picked.map((c) => c.tags)}
            onAddTag={(tag) => {
              const fresh = picked.filter((c) => !c.tags.includes(tag)).map((c) => c.id);
              save(
                ids,
                { type: "addTag", tag },
                (r) => applyChangeLocally(r, ids, { type: "addTag", tag }),
                `Tagged ${n} “${tag}”.`,
                () =>
                  save(fresh, { type: "removeTag", tag }, (r) => applyChangeLocally(r, fresh, { type: "removeTag", tag }), `Took “${tag}” off again.`),
              );
            }}
            onRemoveTag={(tag) => {
              const had = picked.filter((c) => c.tags.includes(tag)).map((c) => c.id);
              save(
                ids,
                { type: "removeTag", tag },
                (r) => applyChangeLocally(r, ids, { type: "removeTag", tag }),
                `Removed “${tag}” from ${had.length}.`,
                () => save(had, { type: "addTag", tag }, (r) => applyChangeLocally(r, had, { type: "addTag", tag }), `Put “${tag}” back.`),
              );
            }}
            onWon={() => move(ids, "won")}
            onLost={() => move(ids, "lost")}
            archived={archived}
            onArchive={(next) => {
              const list = ids;
              save(
                list,
                { type: "archive", archived: next },
                (r) => applyChangeLocally(r, list, { type: "archive", archived: next }),
                next ? `Archived ${n}.` : `Restored ${n}.`,
                () => save(list, { type: "archive", archived: !next }, (r) => applyChangeLocally(r, list, { type: "archive", archived: !next }), next ? "Restored." : "Archived again."),
              );
              setSelected(new Set());
            }}
            onClear={() => setSelected(new Set())}
            extra={
              n === 1 ? (
                <button type="button" className="os-button" onClick={() => setMoving(true)}>
                  Move…
                </button>
              ) : null
            }
          />

          <p
            className="os-cx-status"
            role="status"
            aria-live="polite"
            data-error={status?.error ? "true" : undefined}
          >
            {status?.text ?? ""}
          </p>
          {p.truncated ? (
            <p className="os-cx-status">Showing the 2,000 most recent.</p>
          ) : null}

          <PipelineBoard
            lanes={lanes}
            columns={columns}
            currency={p.currency}
            now={p.now}
            openId={panel.openId}
            selected={selected}
            phoneColumn={phoneColumn}
            onPhoneColumn={setPhoneColumn}
            onOpen={(id) => panel.openId !== id && panel.show(id)}
            onToggle={toggle}
            onMove={(list, col) => move(list, col)}
            onBlocked={(why) => showToast({ text: why, bad: true })}
            onUndoWon={undoWon}
            focusKey={p.focusKey}
          />
        </>
      </section>

      {panel.open ? (
        <PanelHost
          open={panel.open}
          tab={panel.tab}
          onTab={panel.setTab}
          onClose={panel.close}
        />
      ) : null}

      <Toast toast={toaster.toast} onHide={toaster.hide} />

      {moving ? (
        <MoveSheet
          count={n}
          targets={selectionTargets(picked, columns)}
          onClose={() => setMoving(false)}
          onPick={(key) => {
            setMoving(false);
            move(ids, key);
            if (key !== "won") setSelected(new Set());
          }}
        />
      ) : null}

      {wonFor ? (
        <WonPicker
          contactIds={wonFor}
          who={
            wonFor.length === 1
              ? (rows.find((r) => r.id === wonFor[0])?.username ?? "them")
              : `${wonFor.length} people`
          }
          onClose={() => setWonFor(null)}
          onDone={(w) => {
            const done = new Set(wonFor);
            setWonFor(null);
            setSelected(new Set());
            setRows((r) =>
              r.map((c) =>
                done.has(c.id)
                  ? {
                      ...c,
                      kind: "SALES",
                      stage: "WON",
                      won:
                        w.offer !== null && w.amount !== null
                          ? { offer: w.offer, amount: w.amount }
                          : null,
                    }
                  : c,
              ),
            );
            showToast({
              text: w.refused.length
                ? `Marked ${w.count} as Won. ${w.refused.length} couldn't move: ${w.refused[0]}`
                : `Marked ${w.count} as Won${w.amount === null ? " with no amount" : ""}.`,
              undo: () =>
                startTransition(async () => {
                  await undoContactsWon([...done], w.promoted).catch(() => null);
                  showToast({ text: "Undid Won." });
                  router.refresh();
                }),
            });
            if (panel.openId && done.has(panel.openId))
              panel.reload(panel.openId);
          }}
        />
      ) : null}
    </div>
  );
}
