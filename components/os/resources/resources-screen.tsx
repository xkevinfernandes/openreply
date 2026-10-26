"use client";

// /os/resources (Resources canvas): one library. Pills All / Lead magnets /
// Videos / Knowledge docs with counts; a table of Resource, Link, Used by and
// Sent; videos keep their priority order (drag, or arrow keys on the grip).
// Entry paths sit folded at the bottom and aren't counted.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { reorderResources } from "@/app/(os)/os/knowledge/actions";
import { deleteResourceChecked } from "@/app/(os)/os/resources/actions";
import ResourceSheet, { formOf } from "@/components/os/resources/resource-sheet";
import { deleteBlockers, kindLabel, linkLabel, matchesFilter, offeringAgents, type ResourceFilter, type ResourceRow, type ResourcesBoard, type UsedBy } from "@/lib/os/resources-view";
import { moveId } from "@/lib/os/setter/knowledge/resources-view";

const PILLS: { key: ResourceFilter; label: string; count: keyof ResourcesBoard["counts"] }[] = [
  { key: "all", label: "All", count: "all" },
  { key: "magnets", label: "Lead magnets", count: "magnets" },
  { key: "videos", label: "Videos", count: "videos" },
  { key: "docs", label: "Knowledge docs", count: "docs" },
];

type Sheet = { kind: "new" } | { kind: "edit"; row: ResourceRow } | null;
type Delete = { row: ResourceRow; blockers?: UsedBy[]; agents?: UsedBy[]; error?: string } | null;

export default function ResourcesScreen({ board }: { board: ResourcesBoard }) {
  const router = useRouter();
  const [filter, setFilter] = useState<ResourceFilter>("all");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [del, setDel] = useState<Delete>(null);
  const [order, setOrder] = useState(() => board.rows.map((r) => r.id));
  const [dragging, setDragging] = useState<string | null>(null);
  const before = useRef<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const ids = [...order.filter((id) => board.rows.some((r) => r.id === id)), ...board.rows.filter((r) => !order.includes(r.id)).map((r) => r.id)];
  const byId = new Map(board.rows.map((r) => [r.id, r]));
  const shown = ids.map((id) => byId.get(id)!).filter((r) => matchesFilter(r.kind, filter));
  const videoIds = ids.filter((id) => byId.get(id)?.kind === "episode");
  const reorderable = filter === "videos" && !board.sample;

  const commit = (nextVideos: string[], prevAll: string[]) => {
    const next = [...ids];
    const slots = ids.map((id, i) => (byId.get(id)?.kind === "episode" ? i : -1)).filter((i) => i >= 0);
    slots.forEach((slot, i) => (next[slot] = nextVideos[i]));
    setOrder(next);
    setError(null);
    start(async () => {
      const r = await reorderResources(nextVideos);
      if (r.error) {
        setOrder(prevAll);
        setError(r.error);
      }
    });
  };

  const askDelete = (row: ResourceRow, confirmed = false) =>
    start(async () => {
      const r = await deleteResourceChecked(row.id, confirmed);
      if (r.ok) {
        setDel(null);
        setSheet(null);
        router.refresh();
        return;
      }
      setDel({ row, blockers: r.blockers, agents: r.agents, error: r.blockers ? undefined : r.error });
    });

  return (
    <div className="os-rs">
      <header className="os-head">
        <div>
          <h1>Resources</h1>
          <p>One library. Agents, campaigns and broadcasts all pick from here.</p>
        </div>
        <button type="button" className="os-button primary" onClick={() => setSheet({ kind: "new" })}>
          + Add resource
        </button>
      </header>

      <div className="os-rs-pills" role="tablist" aria-label="Show">
        {PILLS.map((p) => (
          <button key={p.key} type="button" role="tab" aria-selected={filter === p.key} className="os-rs-pill" onClick={() => setFilter(p.key)}>
            {p.label}
            <span className="os-rs-count">{board.counts[p.count]}</span>
          </button>
        ))}
      </div>

      {board.sample ? <p className="os-rs-note">Sample resources (OS_MOCK). Add one to start your own list.</p> : null}
      {error ? (
        <p className="os-tg-error" role="alert">
          {error}
        </p>
      ) : null}

      {filter !== "docs" ? (
        board.rows.length ? (
          <section className="os-rs-card" aria-label="Resources">
            <table className="os-rs-table" data-busy={pending || undefined}>
              <thead>
                <tr>
                  {reorderable ? (
                    <th scope="col">
                      <span className="sr-only">Order</span>
                    </th>
                  ) : null}
                  <th scope="col">Resource</th>
                  <th scope="col">Link</th>
                  <th scope="col">Used by</th>
                  <th scope="col" className="os-rs-num">
                    Sent
                  </th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const vi = videoIds.indexOf(r.id);
                  return (
                    <tr
                      key={r.id}
                      data-dragging={dragging === r.id || undefined}
                      onDragOver={(e) => {
                        if (!reorderable || !dragging || dragging === r.id) return;
                        e.preventDefault();
                        const nextVideos = moveId(videoIds, dragging, r.id);
                        const next = [...ids];
                        const slots = ids.map((id, i) => (byId.get(id)?.kind === "episode" ? i : -1)).filter((i) => i >= 0);
                        slots.forEach((slot, i) => (next[slot] = nextVideos[i]));
                        setOrder(next);
                      }}
                      onDrop={(e) => e.preventDefault()}
                    >
                      {reorderable ? (
                        <td className="os-rs-grip-cell">
                          <button
                            type="button"
                            className="os-rs-grip"
                            draggable
                            aria-label={`Reorder ${r.name} (${vi + 1} of ${videoIds.length})`}
                            aria-keyshortcuts="ArrowUp ArrowDown"
                            onDragStart={(e) => {
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("text/plain", r.id);
                              before.current = ids;
                              setDragging(r.id);
                            }}
                            onDragEnd={() => {
                              setDragging(null);
                              if (ids.join() !== before.current.join()) commit(videoIds, before.current);
                            }}
                            onKeyDown={(e) => {
                              const j = e.key === "ArrowUp" ? vi - 1 : e.key === "ArrowDown" ? vi + 1 : -1;
                              if (j < 0 || j >= videoIds.length) return;
                              e.preventDefault();
                              commit(moveId(videoIds, r.id, videoIds[j]), ids);
                            }}
                          >
                            <svg viewBox="0 0 16 16" aria-hidden="true">
                              <path d="M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01" />
                            </svg>
                          </button>
                        </td>
                      ) : null}
                      <td data-label="Resource">
                        <span className="os-rs-name">
                          <strong>{r.name}</strong>
                          <span className="os-rs-kind">{kindLabel(r.kind)}</span>
                          {r.status !== "ACTIVE" ? <span className="os-rs-kind">{r.status === "TEST" ? "Test" : r.kind === "episode" ? "Off" : "Draft"}</span> : null}
                        </span>
                      </td>
                      <td data-label="Link">
                        {r.link ? (
                          <a className="os-rs-link" href={r.link} target="_blank" rel="noreferrer">
                            {linkLabel(r.link)}
                          </a>
                        ) : (
                          <span className="os-rs-nolink">No link yet</span>
                        )}
                      </td>
                      <td data-label="Used by">
                        <UsedChips used={r.usedByAll} />
                      </td>
                      <td data-label="Sent" className="os-rs-num">
                        {r.sent}
                      </td>
                      <td className="os-rs-act">
                        <button type="button" className="os-button ghost" onClick={() => setSheet({ kind: "edit", row: r })}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!shown.length ? (
                  <tr>
                    <td colSpan={reorderable ? 6 : 5} className="os-rs-empty">
                      Nothing here yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </section>
        ) : (
          <section className="os-rs-card os-rs-emptycard">
            <p>No resources yet. Add a lead magnet or a video J can send.</p>
            <button type="button" className="os-button primary" onClick={() => setSheet({ kind: "new" })}>
              + Add resource
            </button>
          </section>
        )
      ) : null}

      {filter === "all" || filter === "docs" ? (
        <section className="os-rs-card" aria-labelledby="os-rs-docs">
          <header className="os-rs-sec-head">
            <h2 id="os-rs-docs">Knowledge docs</h2>
            <p>Write once, give to any agent.</p>
          </header>
          <ul className="os-rs-docs">
            {board.docs.map((d) => (
              <li key={d.key}>
                <Link href={d.href}>
                  <span className="os-rs-doc-text">
                    <strong>{d.name}</strong>
                    <span>{d.sub}</span>
                  </span>
                  <span className="os-rs-doc-used">{d.agents.length ? d.agents.map((a) => a.name).join(" · ") : "Not written yet"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {board.entries.length && filter === "all" ? (
        <details className="os-rs-card os-rs-entries">
          <summary>
            Entry paths <span className="os-rs-count">{board.entries.length}</span>
          </summary>
          <ul>
            {board.entries.map((r) => (
              <li key={r.id}>
                <button type="button" className="os-rs-entry" onClick={() => setSheet({ kind: "edit", row: r })}>
                  {r.name}
                  {r.keyword ? <span className="os-rs-kind">{r.keyword}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {sheet ? (
        <ResourceSheet
          key={sheet.kind === "edit" ? sheet.row.id : "new"}
          initial={sheet.kind === "edit" ? formOf(sheet.row) : undefined}
          agents={board.agents}
          agentIds={sheet.kind === "edit" ? sheet.row.agentIds : []}
          onSaved={() => router.refresh()}
          onClose={() => setSheet(null)}
          onDelete={
            sheet.kind === "edit"
              ? () => setDel({ row: sheet.row, blockers: deleteBlockers(sheet.row.usedByAll), agents: offeringAgents(sheet.row.usedByAll) })
              : undefined
          }
        />
      ) : null}

      {del ? (
        <DeleteDialog
          del={del}
          pending={pending}
          onClose={() => setDel(null)}
          onConfirm={() => askDelete(del.row, true)}
        />
      ) : null}
    </div>
  );
}

function UsedChips({ used }: { used: UsedBy[] }) {
  if (!used.length) return <span className="os-rs-muted">—</span>;
  return (
    <span className="os-rs-chips">
      {used.map((u) => (
        <Link key={`${u.kind}-${u.id}`} href={u.href} className="os-rs-chip" data-kind={u.kind}>
          {u.name}
        </Link>
      ))}
    </span>
  );
}

function DeleteDialog({ del, pending, onClose, onConfirm }: { del: NonNullable<Delete>; pending: boolean; onClose: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const opened = useRef(false);
  const attach = (d: HTMLDialogElement | null) => {
    ref.current = d;
    if (d && !opened.current && typeof d.showModal === "function") {
      opened.current = true;
      d.showModal();
    }
  };
  const blocked = Boolean(del.blockers?.length);
  return (
    <dialog
      ref={attach}
      className="os-tg-dialog"
      aria-label={blocked ? `Can't delete ${del.row.name}` : `Delete ${del.row.name}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="os-tg-form">
        <h2>{blocked ? `Can't delete "${del.row.name}"` : `Delete "${del.row.name}"?`}</h2>
        {blocked ? (
          <>
            <p className="os-tg-hint">It&apos;s used by these. Remove it there first.</p>
            <ul className="os-rs-blockers">
              {del.blockers!.map((b) => (
                <li key={`${b.kind}-${b.id}`}>
                  <Link href={b.href}>
                    {b.kind === "campaign" ? "Campaign" : "Workflow"} {b.name}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : del.agents?.length ? (
          <p className="os-tg-hint">{del.agents.map((a) => a.name).join(", ")} offer{del.agents.length === 1 ? "s" : ""} it. They stop offering it, and their sequences stop sending it.</p>
        ) : null}
        {del.error ? (
          <p className="os-tg-error" role="alert">
            {del.error}
          </p>
        ) : null}
        <div className="os-tg-form-actions">
          <button type="button" className="os-button" onClick={onClose} disabled={pending}>
            {blocked ? "OK" : "Keep it"}
          </button>
          {!blocked ? (
            <button type="button" className="os-button danger" onClick={onConfirm} disabled={pending}>
              {pending ? "Deleting…" : "Delete"}
            </button>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
