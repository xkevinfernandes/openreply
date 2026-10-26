"use client";

// Settings › Tags (Tags canvas): the managed list. Create, rename, recolour
// (a dropdown of the fixed palette), delete, and free an old name. System
// tags can be recoloured but not renamed or deleted; the badge says what
// reads them.

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { addTagAction, deleteTagAction, editTagAction, freeAliasAction } from "@/app/(os)/os/settings/tags-actions";
import { TagColorSelect, TagPill } from "@/components/os/settings/tag-color-select";
import DeleteCheck from "@/components/os/settings/delete-check";
import type { TagBoard, TagRow } from "@/lib/os/tags/board-view";
import { DEFAULT_TAG_COLOR } from "@/lib/os/tags/palette";

type Open = { kind: "new" } | { kind: "edit"; row: TagRow } | { kind: "delete"; row: TagRow; used: TagRow["usedBy"] } | null;

/** A native modal dialog, opened on mount. */
function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="os-tg-dialog"
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {children}
    </dialog>
  );
}

export default function TagsPanel({ board, canManage }: { board: TagBoard; canManage: boolean }) {
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);
  return (
    <div className="os-set-stack">
      <section className="os-set-section os-tg" aria-labelledby="os-tg-title">
        <header className="os-set-section-head os-tg-head">
          <div>
            <h2 id="os-tg-title">Tags</h2>
            <p>Renaming updates every contact, view, broadcast and workflow. Kit keeps receiving the original name.</p>
          </div>
          {canManage ? (
            <button type="button" className="os-button primary" onClick={() => setOpen({ kind: "new" })}>
              New tag
            </button>
          ) : null}
        </header>
        <div className="os-set-tablewrap os-tg-wrap">
          <table className="os-set-table os-tg-table">
            <thead>
              <tr>
                <th scope="col">Tag</th>
                <th scope="col" className="os-tg-num">
                  Contacts
                </th>
                <th scope="col">Used by</th>
                <th scope="col">Kit name</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {board.rows.map((r) => (
                <tr key={r.id}>
                  <td data-label="Tag">
                    <span className="os-tg-name">
                      <TagPill name={r.name} color={r.color} />
                      {r.system ? (
                        <span className="os-tg-system" tabIndex={0} title={`System tag, read by ${r.readBy}. Can't be renamed or deleted.`} aria-label={`System tag, read by ${r.readBy}`}>
                          System
                        </span>
                      ) : null}
                    </span>
                    {r.aliases.length ? <small className="os-tg-aliases">Was {r.aliases.map((a) => a.name).join(", ")}</small> : null}
                  </td>
                  <td data-label="Contacts" className="os-tg-num">
                    {r.contacts}
                  </td>
                  <td data-label="Used by" className="os-tg-muted">
                    {r.system ? r.readBy : r.usedBy.length ? r.usedBy.map((u) => u.name).join(", ") : "—"}
                  </td>
                  <td data-label="Kit name" className="os-tg-muted" title={r.kitSynced ? undefined : "Kit hasn't received it yet. It goes under its name then."}>
                    {r.kitSynced ? (r.kitNames[0] ?? r.name) : "Not sent yet"}
                  </td>
                  <td className="os-tg-actions">
                    {canManage ? (
                      <>
                        <button type="button" className="os-button ghost" onClick={() => setOpen({ kind: "edit", row: r })}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="os-button ghost"
                          disabled={r.system}
                          title={r.system ? `System tag: ${r.readBy} reads it by name.` : undefined}
                          onClick={() => setOpen({ kind: "delete", row: r, used: r.usedBy })}
                        >
                          Delete
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
              {!board.rows.length ? (
                <tr>
                  <td colSpan={5} className="os-set-empty">
                    No tags yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {open?.kind === "new" ? <TagEditor onClose={close} /> : null}
      {open?.kind === "edit" ? <TagEditor row={open.row} onClose={close} /> : null}
      {open?.kind === "delete" ? <DeleteTag row={open.row} used={open.used} onClose={close} onRefused={(used) => setOpen({ kind: "delete", row: open.row, used })} /> : null}
    </div>
  );
}

function TagEditor({ row, onClose }: { row?: TagRow; onClose: () => void }) {
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState(row?.name ?? "");
  const [color, setColor] = useState(row?.color ?? DEFAULT_TAG_COLOR);
  const [aliases, setAliases] = useState(row?.aliases ?? []);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const locked = Boolean(row?.system);
  // Only a tag Kit has received keeps its Kit name on a rename.
  const kitName = row?.kitSynced ? (row.kitNames[0] ?? row.name) : null;

  const save = () =>
    start(async () => {
      setError(null);
      const r = row
        ? await editTagAction(row.id, { color, ...(locked || name.trim() === row.name ? {} : { name }) })
        : await addTagAction(name, color);
      if (!r.ok) return setError(r.error);
      onClose();
      router.refresh();
    });

  return (
    <Modal label={row ? `Edit ${row.name}` : "New tag"} onClose={onClose}>
      <form
        className="os-tg-form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <h2>{row ? `Edit "${row.name}"` : "New tag"}</h2>
        <label htmlFor={`${id}-name`}>
          <span>Name</span>
        </label>
        <input
          id={`${id}-name`}
          className="os-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={locked}
          title={locked ? `System tag: ${row?.readBy} reads it by name.` : undefined}
          maxLength={60}
          required
          autoFocus={!locked}
        />
        <label htmlFor={`${id}-color`}>
          <span>Colour</span>
        </label>
        <TagColorSelect id={`${id}-color`} value={color} onChange={setColor} />
        <p className="os-tg-hint">A fixed set, each with a light and a dark shade, so tags read in both themes.</p>
        {row && kitName ? <p className="os-tg-hint">Kit keeps receiving &ldquo;{kitName}&rdquo;, whatever you rename it to.</p> : null}
        {aliases.length ? (
          <div className="os-tg-old">
            <span>Old names</span>
            <ul>
              {aliases.map((a) => (
                <li key={a.id}>
                  <span>{a.name}</span>
                  <button
                    type="button"
                    className="os-button ghost"
                    disabled={pending}
                    title="It stops landing on this tag, and the name can be used again."
                    onClick={() =>
                      start(async () => {
                        const r = await freeAliasAction(a.id);
                        if (!r.ok) return setError(r.error);
                        setAliases((list) => list.filter((x) => x.id !== a.id));
                        router.refresh();
                      })
                    }
                  >
                    Free
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {error ? (
          <p className="os-tg-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="os-tg-form-actions">
          <button type="button" className="os-button" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="os-button primary" disabled={pending || !name.trim()}>
            {pending ? "Saving…" : row ? "Save" : "Create"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteTag({ row, used, onClose, onRefused }: { row: TagRow; used: TagRow["usedBy"]; onClose: () => void; onRefused: (used: TagRow["usedBy"]) => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const blocked = used.length > 0;

  const run = (force: boolean) =>
    start(async () => {
      setError(null);
      const r = await deleteTagAction(row.id, force);
      if (r.ok) {
        onClose();
        router.refresh();
        return;
      }
      if ("usage" in r && r.usage && !force) {
        onRefused([
          ...r.usage.broadcasts.map((b) => ({ kind: "broadcast" as const, id: b.id, name: b.name })),
          ...r.usage.workflows.map((w) => ({ kind: "workflow" as const, id: w.id, name: w.name })),
        ]);
        return;
      }
      setError(r.error);
    });

  return (
    <DeleteCheck
      name={row.name}
      used={used}
      note={row.contacts ? `It comes off ${row.contacts} contact${row.contacts === 1 ? "" : "s"}.` : null}
      error={error}
      pending={pending}
      onClose={onClose}
      onConfirm={() => run(blocked)}
    />
  );
}
