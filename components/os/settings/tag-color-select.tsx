"use client";

// The tag colour pick: a select-style dropdown, one row per colour of the
// fixed palette (swatch + name). Not a row of swatches (Kevin, 2026-10-26).

import { useEffect, useId, useRef, useState } from "react";
import { TAG_COLORS, tagColor, type TagColor } from "@/lib/os/tags/palette";

/** The light and dark values as CSS variables; tags.css picks per theme. */
export function tagVars(c: TagColor): React.CSSProperties {
  return {
    "--tag-l-bg": c.light.bg,
    "--tag-l-fg": c.light.fg,
    "--tag-d-bg": c.dark.bg,
    "--tag-d-fg": c.dark.fg,
  } as React.CSSProperties;
}

export function TagPill({ name, color }: { name: string; color: string }) {
  return (
    <span className="os-tg-pill" style={tagVars(tagColor(color))}>
      {name}
    </span>
  );
}

export function TagColorSelect({ value, onChange, id, disabled }: { value: string; onChange: (key: string) => void; id?: string; disabled?: boolean }) {
  const auto = useId();
  const buttonId = id ?? auto;
  const listId = `${buttonId}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => Math.max(0, TAG_COLORS.findIndex((c) => c.key === value)));
  const wrap = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const current = tagColor(value);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    list.current?.focus();
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const pick = (i: number) => {
    onChange(TAG_COLORS[i].key);
    setOpen(false);
    document.getElementById(buttonId)?.focus();
  };

  return (
    <div className="os-tg-select" ref={wrap}>
      <button
        type="button"
        id={buttonId}
        className="os-tg-select-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => {
          setActive(Math.max(0, TAG_COLORS.findIndex((c) => c.key === value)));
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="os-tg-swatch" style={tagVars(current)} aria-hidden="true" />
        <span className="os-tg-select-label">{current.label}</span>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
        </svg>
      </button>
      {open ? (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          tabIndex={-1}
          className="os-tg-select-list"
          aria-labelledby={buttonId}
          aria-activedescendant={`${listId}-${TAG_COLORS[active].key}`}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(TAG_COLORS.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              pick(active);
            } else if (e.key === "Escape" || e.key === "Tab") {
              e.preventDefault();
              setOpen(false);
              document.getElementById(buttonId)?.focus();
            }
          }}
        >
          {TAG_COLORS.map((c, i) => (
            <li
              key={c.key}
              id={`${listId}-${c.key}`}
              role="option"
              aria-selected={c.key === value}
              data-active={i === active || undefined}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(i)}
            >
              <span className="os-tg-swatch" style={tagVars(c)} aria-hidden="true" />
              {c.label}
              {c.key === value ? (
                <svg viewBox="0 0 16 16" aria-hidden="true" className="os-tg-check">
                  <path d="m3.5 8.5 3 3 6-7" />
                </svg>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
