"use client";

// ⌘K command palette (Palette board). The shell renders it once. It searches
// threads/contacts, screens and KB docs (full text on the server), and runs
// actions on the open thread through the os:* event bus (components/os/keys.ts)
// so it never imports the composer. ">" shows actions only.
//
// Global keys it owns: ⌘K / Ctrl+K, G-chords (G H, G I, G C, G F, G A, G K,
// G S), and on an open thread S (move to stage…), L (send lead magnet…) and
// ⌘O (open in Instagram).

import { usePathname, useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emitOs, isTypingTarget, PALETTE_EVENT } from "@/components/os/keys";
import { paletteDocs, paletteIndex } from "@/lib/os/palette/actions";
import type { DocHit, PaletteIndex } from "@/lib/os/palette/data";
import {
  chordHref,
  contactHref,
  instagramHref,
  matchRange,
  parseQuery,
  searchPalette,
  threadFromUrl,
  type PaletteAction,
  type PaletteContact,
  type PaletteScreen,
} from "@/lib/os/palette/search";

type Pick = "move-stage" | "send-resource";

type Item =
  | { kind: "contact"; id: string; c: PaletteContact }
  | { kind: "action"; id: string; a: PaletteAction }
  | { kind: "screen"; id: string; s: PaletteScreen }
  | { kind: "doc"; id: string; d: { file: string; setterName: string; href: string; note?: string } }
  | { kind: "pick"; id: string; label: string; value: string };

const ICON: Record<string, string> = {
  approve: "M3 8.5 6.5 12 13 4.5",
  hold: "M5.5 3.5v9M10.5 3.5v9",
  regenerate: "M12.5 6.5A4.8 4.8 0 1 0 13 9M12.8 3v3.5H9.3",
  "focus-draft": "M10.5 2.8 13.2 5.5 6 12.7H3.3V10L10.5 2.8Z",
  "move-stage": "M2.5 8h9M8.5 4.5 12 8l-3.5 3.5",
  "send-resource": "M10 4.5 5.4 9.1a1.4 1.4 0 0 0 2 2l5-5a2.8 2.8 0 0 0-4-4L3.3 7.2a4.2 4.2 0 0 0 6 6l3.2-3.2",
  "open-instagram": "M9.5 2.5h4v4M13.5 2.5 8 8M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3",
  screen: "M8 13.8A5.8 5.8 0 1 0 8 2.2a5.8 5.8 0 0 0 0 11.6ZM8 4.8V8l2.2 1.4",
  doc: "M4 1.8h5.5L12.5 5v9.2H4V1.8ZM9.5 1.8V5h3",
  search: "M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM10.5 10.5l3 3",
};

function Svg({ d }: { d: string }) {
  return (
    <svg className="os-pal-ic" viewBox="0 0 16 16" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function Hl({ text, q }: { text: string; q: string }) {
  const r = matchRange(text, q);
  if (!r) return <>{text}</>;
  return (
    <>
      {text.slice(0, r[0])}
      <strong>{text.slice(r[0], r[1])}</strong>
      {text.slice(r[1])}
    </>
  );
}

/** The option index under a pointer event target. */
function optionAt(target: EventTarget | null): number | null {
  const el = (target as HTMLElement | null)?.closest?.("[data-i]");
  const i = el ? Number(el.getAttribute("data-i")) : NaN;
  return Number.isFinite(i) ? i : null;
}

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="os-pal-keys">
      {keys.map((k) => (
        <kbd key={k}>{k}</kbd>
      ))}
    </span>
  );
}

export default function PaletteMount() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pick, setPick] = useState<Pick | null>(null);
  const [sel, setSel] = useState(0);
  const [index, setIndex] = useState<PaletteIndex | null>(null);
  const [docHits, setDocHits] = useState<DocHit[]>([]);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restore = useRef<HTMLElement | null>(null);
  const loading = useRef<Promise<PaletteIndex | null> | null>(null);

  const load = useCallback(() => {
    loading.current ??= paletteIndex()
      .then((i) => {
        if (i) setIndex(i);
        return i;
      })
      .finally(() => {
        loading.current = null;
      });
    return loading.current;
  }, []);

  const show = useCallback(
    (q = "", p: Pick | null = null) => {
      restore.current = document.activeElement as HTMLElement | null;
      setSearch(window.location.search);
      setQuery(q);
      setPick(p);
      setSel(0);
      setDocHits([]);
      setOpen(true);
      void load();
    },
    [load]
  );

  const close = useCallback(() => {
    setOpen(false);
    setPick(null);
    restore.current?.focus?.();
  }, []);

  const thread = useMemo(() => (index ? threadFromUrl(pathname ?? "", search, index.contacts) : null), [index, pathname, search]);

  // Prefetch once the page is idle so ⌘K opens with results.
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 1500);
    return () => window.clearTimeout(t);
  }, [load]);

  // Global keys: ⌘K, G-chords, S / L / ⌘O on an open thread.
  useEffect(() => {
    let g = 0;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) close();
        else show();
        return;
      }
      if (open || e.defaultPrevented || isTypingTarget(e.target)) return;
      if (mod && !e.altKey && e.key.toLowerCase() === "o") {
        const here = index ? threadFromUrl(window.location.pathname, window.location.search, index.contacts) : null;
        const href = instagramHref(here?.username ?? null);
        if (href) {
          e.preventDefault();
          window.open(href, "_blank", "noopener");
        }
        return;
      }
      if (mod || e.altKey) return;
      if (g && Date.now() - g < 1200) {
        g = 0;
        const href = chordHref(e.key);
        if (href) {
          e.preventDefault();
          router.push(href);
        }
        return;
      }
      if (e.key === "g" || e.key === "G") {
        g = Date.now();
        return;
      }
      if ((e.key === "s" || e.key === "S" || e.key === "l" || e.key === "L") && /[?&](c|contact)=/.test(window.location.search)) {
        e.preventDefault();
        show("", e.key.toLowerCase() === "s" ? "move-stage" : "send-resource");
      }
    };
    const onOpen = (e: Event) => show((e as CustomEvent<{ query?: string }>).detail?.query ?? "");
    window.addEventListener("keydown", onKey);
    window.addEventListener(PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(PALETTE_EVENT, onOpen);
    };
  }, [open, show, close, router, index]);

  // KB full text, debounced.
  const parsed = parseQuery(query);
  const docQuery = !pick && !parsed.actionsOnly && parsed.text.length >= 2 ? parsed.text : "";
  useEffect(() => {
    if (!open || !docQuery) return;
    let live = true;
    const t = window.setTimeout(() => {
      void paletteDocs(docQuery).then((hits) => live && setDocHits(hits));
    }, 180);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [open, docQuery]);

  const groups = useMemo((): { title: string; items: Item[] }[] => {
    if (!index) return [];
    if (pick && thread) {
      const list =
        pick === "move-stage"
          ? (index.stages[thread.setterId ?? ""] ?? index.stages[""] ?? []).map((s) => ({ value: s.key, label: s.label }))
          : index.resources.map((r) => ({ value: r.id, label: r.name }));
      const q = query.trim().toLowerCase();
      return [
        {
          title: pick === "move-stage" ? `Move ${thread.username ?? "contact"} to` : `Send ${thread.username ?? "them"}`,
          items: list.filter((x) => !q || x.label.toLowerCase().includes(q)).map((x) => ({ kind: "pick" as const, id: `pick:${x.value}`, label: x.label, value: x.value })),
        },
      ];
    }
    const r = searchPalette(query, index, !!thread, thread);
    const fullText = docQuery ? docHits.filter((h) => !r.docs.some((d) => d.setterId === h.setterId && d.key === h.key)) : [];
    const goto: Item[] = [
      ...r.screens.map((s) => ({ kind: "screen" as const, id: `screen:${s.key}`, s })),
      ...r.docs.map((d) => ({ kind: "doc" as const, id: `doc:${d.setterId}:${d.key}`, d })),
      ...fullText.map((h) => ({ kind: "doc" as const, id: `doc:${h.setterId}:${h.key}`, d: { ...h, note: h.snippet } })),
    ];
    return [
      { title: "Contacts", items: r.contacts.map((c) => ({ kind: "contact" as const, id: `contact:${c.id}`, c })) },
      { title: "Actions", items: r.actions.map((a) => ({ kind: "action" as const, id: `action:${a.key}`, a })) },
      { title: "Go to", items: goto },
    ].filter((g) => g.items.length);
  }, [index, pick, thread, query, docQuery, docHits]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const active = Math.min(sel, Math.max(0, flat.length - 1));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function run(item: Item) {
    const contactId = thread?.id;
    switch (item.kind) {
      case "contact":
        close();
        router.push(contactHref(item.c));
        return;
      case "screen":
        close();
        router.push(item.s.href);
        return;
      case "doc":
        close();
        router.push(item.d.href);
        return;
      case "pick":
        close();
        window.setTimeout(() => {
          if (pick === "move-stage") emitOs("move-stage", { contactId, stage: item.value });
          else emitOs("send-resource", { contactId, resourceId: item.value });
        }, 0);
        return;
      case "action": {
        const a = item.a;
        if (a.picks) {
          setPick(a.key as Pick);
          setQuery("");
          setSel(0);
          inputRef.current?.focus();
          return;
        }
        if (a.key === "open-instagram") {
          const href = instagramHref(thread?.username ?? null);
          close();
          if (href) window.open(href, "_blank", "noopener");
          return;
        }
        close();
        // After the dialog is gone, so the composer gets focus and the key event is clean.
        window.setTimeout(() => emitOs(a.key as "approve" | "hold" | "regenerate" | "focus-draft", { contactId }), 0);
        return;
      }
    }
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => (flat.length ? (Math.min(s, flat.length - 1) + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => (flat.length ? (Math.min(s, flat.length - 1) - 1 + flat.length) % flat.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const item = flat[active];
      if (item) run(item);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (pick) {
        setPick(null);
        setQuery("");
      } else close();
    } else if (e.key === "Backspace" && pick && !query) {
      setPick(null);
    } else if (e.key === "Tab") {
      e.preventDefault();
    }
  }

  if (!open) return null;
  const optionId = (i: number) => `os-pal-opt-${i}`;
  let n = -1;

  return (
    <div className="os-palette-scrim" role="presentation" onMouseDown={close}>
      <div className="os-palette" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <label className="os-pal-q">
          <Svg d={ICON.search} />
          {pick ? <span className="os-pal-crumb">{pick === "move-stage" ? "Move to stage" : "Send lead magnet"}</span> : null}
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={query}
            placeholder={pick ? "Filter…" : "Search or run a command"}
            aria-label="Search or run a command"
            role="combobox"
            aria-expanded="true"
            aria-controls="os-pal-list"
            aria-activedescendant={flat.length ? optionId(active) : undefined}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value);
              setSel(0);
            }}
            onKeyDown={onInputKey}
          />
          <kbd className="os-pal-esc">esc</kbd>
        </label>

        <div
          className="os-pal-list"
          id="os-pal-list"
          role="listbox"
          aria-label="Results"
          ref={listRef}
          onMouseMove={(e) => {
            const i = optionAt(e.target);
            if (i !== null && i !== sel) setSel(i);
          }}
          onClick={(e) => {
            const i = optionAt(e.target);
            if (i !== null && flat[i]) run(flat[i]);
          }}
        >
          {!index ? (
            <p className="os-pal-empty">Loading…</p>
          ) : !flat.length ? (
            <p className="os-pal-empty">{pick && !thread ? "Open a thread first." : "Nothing found."}</p>
          ) : (
            groups.map((g) => (
              <Fragment key={g.title}>
                <div className="os-pal-group" role="presentation">
                  {g.title}
                </div>
                {g.items.map((item) => {
                  n += 1;
                  const i = n;
                  const on = i === active;
                  const common = {
                    id: optionId(i),
                    role: "option" as const,
                    "aria-selected": on,
                    "data-i": i,
                    className: "os-pal-opt",
                  };
                  const q = parsed.text;
                  switch (item.kind) {
                    case "contact": {
                      const name = item.c.username ?? item.c.fullName ?? "Unknown";
                      return (
                        <div key={item.id} {...common} data-kind="contact">
                          <span className="os-pal-av" aria-hidden="true">
                            {name.charAt(0).toUpperCase()}
                          </span>
                          <span className="os-pal-main">
                            <Hl text={name} q={q} />
                            {item.c.stage ? <span className="muted"> · {item.c.stage}</span> : null}
                          </span>
                          {item.c.draftWaiting ? (
                            <span className="os-pal-draft">
                              <span className="os-dot" aria-hidden="true" />
                              Draft waiting
                            </span>
                          ) : null}
                          <span className="os-pal-enter" aria-hidden="true">
                            {on ? "⏎" : ""}
                          </span>
                        </div>
                      );
                    }
                    case "action":
                      return (
                        <div key={item.id} {...common}>
                          <Svg d={ICON[item.a.key]} />
                          <span className="os-pal-main">
                            {item.a.label}
                            {item.a.key === "approve" && thread ? <span className="ghost"> · {thread.username ?? "this thread"}</span> : null}
                          </span>
                          <Keys keys={item.a.keys} />
                        </div>
                      );
                    case "screen":
                      return (
                        <div key={item.id} {...common}>
                          <Svg d={ICON.screen} />
                          <span className="os-pal-main">
                            {item.s.trail ? <span className="muted">{item.s.trail}</span> : null}
                            <Hl text={item.s.label} q={q} />
                          </span>
                          {item.s.chord ? <Keys keys={["G", item.s.chord]} /> : null}
                        </div>
                      );
                    case "doc":
                      return (
                        <div key={item.id} {...common}>
                          <Svg d={ICON.doc} />
                          <span className="os-pal-main">
                            <span className="muted">Knowledge bases › {item.d.setterName} › </span>
                            {item.d.file}
                          </span>
                          {item.d.note ? <span className="os-pal-note">{item.d.note}</span> : null}
                        </div>
                      );
                    case "pick":
                      return (
                        <div key={item.id} {...common}>
                          <Svg d={ICON[pick ?? "move-stage"]} />
                          <span className="os-pal-main">
                            <Hl text={item.label} q={query} />
                          </span>
                        </div>
                      );
                  }
                })}
              </Fragment>
            ))
          )}
        </div>

        <div className="os-pal-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd>
            Navigate
          </span>
          <span>
            <kbd>⏎</kbd>
            Open
          </span>
          <span>
            <kbd>esc</kbd>
            Close
          </span>
          <span className="os-pal-hint">
            Type <b>&gt;</b> for actions only
          </span>
        </div>
      </div>
    </div>
  );
}
