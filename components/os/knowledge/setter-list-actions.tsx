"use client";

import { Button } from "@claudepreneur/brand/react";
import Link from "next/link";
import { useState } from "react";
import { createSetter, importKnowledge } from "@/app/(os)/os/knowledge/actions";
import { Select, useSaver } from "@/components/os/knowledge/fields";
import { KbIcon } from "@/components/os/knowledge/icons";

/** "New setter" opens the interview (/os/knowledge/new). */
export function NewSetter({ compact = false }: { setters?: { id: string; name: string }[]; compact?: boolean }) {
  return compact ? (
    <Link href="/os/knowledge/new" className="kb-switch-tab cp-tab kb-switch-new">
      <KbIcon name="plus" size={12} />
      New setter
    </Link>
  ) : (
    <Link href="/os/knowledge/new" className="cp-btn cp-btn-primary">
      New setter
    </Link>
  );
}

/** The quick way: an empty setter or a copy of one (no interview). */
export function CopySetter({ setters, compact = false }: { setters: { id: string; name: string }[]; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [copy, setCopy] = useState(setters[0]?.id ?? "");
  const saver = useSaver();
  if (!open) {
    return compact ? (
      <button type="button" className="kb-quiet kb-linkbtn" onClick={() => setOpen(true)}>
        Or copy a setter
      </button>
    ) : (
      <Button variant="text" onClick={() => setOpen(true)}>
        Copy a setter
      </Button>
    );
  }
  return (
    <form
      className="os-kb-newsetter"
      onSubmit={(e) => {
        e.preventDefault();
        saver.run(() => createSetter(name, copy || null));
      }}
    >
      <label className="sr-only" htmlFor="os-new-setter">
        Name
      </label>
      <input id="os-new-setter" className="os-input" autoFocus placeholder="Name, e.g. Workshop setter" value={name} onChange={(e) => setName(e.target.value)} />
      {setters.length > 0 && (
        <Select aria-label="Start from" value={copy} onChange={setCopy} options={[["", "Start empty"], ...setters.map((s): [string, string] => [s.id, `Copy of ${s.name}`])]} />
      )}
      <Button variant="text" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      <Button type="submit" variant="primary" disabled={!name.trim() || saver.pending}>
        {saver.pending ? "Creating…" : "Create"}
      </Button>
      {saver.note?.kind === "error" && <span className="os-kb-note" data-kind="error">{saver.note.text}</span>}
    </form>
  );
}

export function ImportButton() {
  const saver = useSaver();
  return (
    <>
      {/* Secondary: New setter is the page's one primary action. */}
      <Button disabled={saver.pending} aria-busy={saver.pending || undefined} onClick={() => saver.run(() => importKnowledge())}>
        {saver.pending ? "Importing…" : "Import the claudepreneur files"}
      </Button>
      {saver.pending ? (
        <span className="os-kb-note" role="status">
          Reading J&apos;s files and lead magnets. This takes a few seconds.
        </span>
      ) : null}
      {saver.note?.kind === "error" && <span className="os-kb-note" data-kind="error">{saver.note.text}</span>}
    </>
  );
}
