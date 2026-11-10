"use client";

// The tag colour pick: a select-style dropdown, one row per colour of the
// fixed palette (swatch + name). Not a row of swatches (Kevin, 2026-10-26).

import { Select } from "@claudepreneur/brand/react";
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

/** The colour pick: the shared Select (@claudepreneur/brand) with a swatch per row. */
export function TagColorSelect({ value, onChange, id, disabled }: { value: string; onChange: (key: string) => void; id?: string; disabled?: boolean }) {
  return (
    <Select
      id={id}
      aria-label="Colour"
      value={tagColor(value).key}
      onChange={onChange}
      disabled={disabled}
      options={TAG_COLORS.map((c) => ({ value: c.key, label: c.label, icon: <span className="os-tg-swatch" style={tagVars(c)} aria-hidden="true" /> }))}
    />
  );
}
