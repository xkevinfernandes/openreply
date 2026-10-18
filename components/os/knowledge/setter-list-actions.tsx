"use client";

import { useState } from "react";
import { createSetter, importKnowledge } from "@/app/(os)/os/knowledge/actions";
import { useSaver } from "@/components/os/knowledge/fields";

export function NewSetter({ setters }: { setters: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [copy, setCopy] = useState(setters[0]?.id ?? "");
  const saver = useSaver();
  if (!open) {
    return (
      <button type="button" className="os-button primary" onClick={() => setOpen(true)}>
        New setter
      </button>
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
        <span className="os-select">
          <select aria-label="Start from" value={copy} onChange={(e) => setCopy(e.target.value)}>
            <option value="">Start empty</option>
            {setters.map((s) => (
              <option key={s.id} value={s.id}>
                Copy of {s.name}
              </option>
            ))}
          </select>
        </span>
      )}
      <button type="button" className="os-button ghost" onClick={() => setOpen(false)}>
        Cancel
      </button>
      <button type="submit" className="os-button primary" disabled={!name.trim() || saver.pending}>
        {saver.pending ? "Creating…" : "Create"}
      </button>
      {saver.note?.kind === "error" && <span className="os-kb-note" data-kind="error">{saver.note.text}</span>}
    </form>
  );
}

export function ImportButton() {
  const saver = useSaver();
  return (
    <>
      <button type="button" className="os-button primary" disabled={saver.pending} onClick={() => saver.run(() => importKnowledge())}>
        {saver.pending ? "Importing…" : "Import the claudepreneur files"}
      </button>
      {saver.note?.kind === "error" && <span className="os-kb-note" data-kind="error">{saver.note.text}</span>}
    </>
  );
}
