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
import { undoContactWon, updateContacts } from "@/app/(os)/os/contacts/actions";
import PanelHost, {
  usePanel,
  type OpenPanel,
} from "@/components/os/contacts/panel-host";
import WonPicker from "@/components/os/contacts/won-picker";
import { threadName } from "@/components/os/inbox/names";
import { useOsCommand } from "@/components/os/keys";
import MoveSheet from "@/components/os/pipeline/setter-move-sheet";
import PipelineBoard from "@/components/os/pipeline/setter-board";
import { Tabs } from "@/components/os/ui";
import type { PanelTab } from "@/lib/os/contact-panel/types";
import type { ContactRow, SetterOption } from "@/lib/os/contacts-board";
import type { ContactChange } from "@/lib/os/contacts-edit";
import { applyChangeLocally, normalizeTag } from "@/lib/os/contacts-filter";
import { matchesSearch } from "@/lib/os/contacts-view";
import {
  ALL_BOARD,
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
  const [tag, setTag] = useState("");
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
  const [phoneColumn, setPhoneColumn] = useState<string>(
    p.focusKey && columns.some((c) => c.key === p.focusKey)
      ? p.focusKey
      : (columns[0]?.key ?? ""),
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
    ) => {
      let before: ContactRow[] = [];
      setRows((r) => {
        before = r;
        return local(r);
      });
      setStatus(done ? { text: done } : null);
      startTransition(async () => {
        let error: string | undefined;
        try {
          error = (await updateContacts(ids, change)).error;
        } catch {
          error = "That didn't save. Try again.";
        }
        if (error) {
          setRows(before);
          setStatus({ text: error, error: true });
        } else if (panel.openId && ids.includes(panel.openId))
          panel.reload(panel.openId);
      });
    },
    [panel],
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
      if ("error" in r) return setStatus({ text: r.error, error: true });
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
      setStatus({
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
  const switcher = [
    { key: ALL_BOARD, label: "All · funnel" },
    ...p.setters.map((s) => ({ key: s.id, label: s.name })),
  ];

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
          <Tabs
            tabs={switcher}
            value={p.setterId}
            ariaLabel="Board"
            hrefFor={(k) =>
              k === ALL_BOARD
                ? "/os/pipeline/all"
                : `/os/pipeline?setter=${encodeURIComponent(k)}`
            }
          />
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
          {n ? (
            <div
              className="os-ct-bulk os-cv-bulk"
              data-on="true"
              role="region"
              aria-label="Selected cards"
            >
              <span className="os-ct-count">
                <strong>{n}</strong> selected
              </span>
              <form
                className="os-ct-tag-add"
                onSubmit={(e) => {
                  e.preventDefault();
                  const t = normalizeTag(tag);
                  if (!t) return;
                  save(
                    ids,
                    { type: "addTag", tag: t },
                    (r) =>
                      applyChangeLocally(r, ids, { type: "addTag", tag: t }),
                    `Tagged ${n} “${t}”.`,
                  );
                  setTag("");
                }}
              >
                <input
                  className="os-input"
                  aria-label="Tag to add"
                  placeholder="Tag"
                  list="os-pl-tags"
                  value={tag}
                  maxLength={40}
                  onChange={(e) => setTag(e.target.value)}
                />
                <datalist id="os-pl-tags">
                  {p.tags.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
                <button
                  type="submit"
                  className="os-button"
                  disabled={!normalizeTag(tag)}
                >
                  Add
                </button>
              </form>
              <button
                type="button"
                className="os-button primary"
                onClick={() => setMoving(true)}
              >
                Move selected…
              </button>
              <button
                type="button"
                className="os-button"
                onClick={() => {
                  save(
                    ids,
                    { type: "archive", archived: !archived },
                    (r) =>
                      applyChangeLocally(r, ids, {
                        type: "archive",
                        archived: !archived,
                      }),
                    archived ? `Restored ${n}.` : `Archived ${n}.`,
                  );
                  setSelected(new Set());
                }}
              >
                {archived ? "Restore" : "Archive"}
              </button>
              <button
                type="button"
                className="os-button ghost"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </button>
            </div>
          ) : null}

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
            onMove={(id, col) => move([id], col)}
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
                      stage: "WON",
                      won: { offer: w.offer, amount: w.amount },
                    }
                  : c,
              ),
            );
            setStatus({
              text: w.refused.length
                ? `Marked ${w.count} as Won. ${w.refused.length} couldn't move: ${w.refused[0]}`
                : `Marked ${w.count} as Won.`,
            });
            if (panel.openId && done.has(panel.openId))
              panel.reload(panel.openId);
          }}
        />
      ) : null}
    </div>
  );
}
